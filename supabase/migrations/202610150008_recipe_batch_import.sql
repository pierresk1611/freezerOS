-- Additive import ledger. Original import_recipes/revise_recipe and all snapshots stay unchanged.
create table public.recipe_import_sources(user_id uuid not null references auth.users on delete cascade,import_id uuid not null,payload jsonb not null,legacy boolean not null,created_at timestamptz not null default now(),primary key(user_id,import_id));
create table public.recipe_import_items(user_id uuid not null references auth.users on delete cascade,import_id uuid not null,item_index integer not null check(item_index between 0 and 49),recipe_id uuid references public.recipes on delete set null,version_id uuid references public.recipe_versions on delete set null,outcome text not null check(outcome in('added','version','legacy')),created_at timestamptz not null default now(),primary key(user_id,import_id,item_index),foreign key(user_id,import_id) references public.recipe_import_sources on delete cascade);
alter table public.recipe_import_sources enable row level security;
alter table public.recipe_import_items enable row level security;
create policy own_import_sources on public.recipe_import_sources for select to authenticated using(user_id=(select auth.uid()));
create policy own_import_items on public.recipe_import_items for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.recipe_import_sources,public.recipe_import_items from anon,authenticated;
grant select on public.recipe_import_sources,public.recipe_import_items to authenticated;
create function public.recipe_import_text(p text) returns text language sql immutable set search_path='' as $$ select lower(regexp_replace(regexp_replace(pg_catalog.normalize(btrim(coalesce(p,'')),'NFD'),'[̀-ͯ]','','g'),'\s+',' ','g')) $$;
create function public.recipe_import_value(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('portions',(p->>'portions')::numeric,'meat',coalesce(p->>'meat','none'),'freezing',coalesce((p->>'freezing')::boolean,true),'storage',public.recipe_import_text(coalesce(p->>'storage','Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.')),'reheating',public.recipe_import_text(p->>'reheating'),
 'ingredients',(select jsonb_agg(jsonb_build_array(public.recipe_import_text(i->>'name'),(i->>'quantity')::numeric,i->>'unit') order by public.recipe_import_text(i->>'name'),i->>'unit',(i->>'quantity')::numeric) from jsonb_array_elements(p->'ingredients') i),
 'steps',(select jsonb_agg(public.recipe_import_text(s) order by n) from jsonb_array_elements_text(p->'steps') with ordinality t(s,n)),
 'metadata',jsonb_strip_nulls(jsonb_build_object('category',coalesce(p->>'category','general'),'cooking_method',p->'cooking_method','prep_minutes',p->'prep_minutes','cooking_minutes_min',p->'cooking_minutes_min','cooking_minutes_max',p->'cooking_minutes_max','oven_c',p->'oven_c')))
$$;
create function public.import_recipe_item(p_import_id uuid,p_payload jsonb,p_index integer,p_mode text,p_target uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.recipe_import_sources; prior public.operation_requests; done public.recipe_import_items; item jsonb; root uuid; version_id uuid; target public.recipe_versions; match_id uuid; match_archived boolean; child uuid; legacy boolean; before_ids uuid[]; reference jsonb; j integer;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if p_import_id is null or jsonb_typeof(p_payload) is distinct from 'array' or jsonb_array_length(p_payload) not between 1 and 50 or octet_length(p_payload::text)>2000000 or p_index is null or p_index<0 or p_index>=jsonb_array_length(p_payload) or p_mode is null or p_mode not in('new','version') then raise exception 'INVALID_SELECTION';end if;
 -- Serializes all new import paths for one owner, including different source files.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8008));
 select * into source from public.recipe_import_sources where user_id=auth.uid() and import_id=p_import_id;
 if found then
  if source.payload<>p_payload then raise exception 'SOURCE_CHANGED';end if;
  legacy:=source.legacy;
 else
  select * into prior from public.operation_requests where user_id=auth.uid() and id=p_import_id;
  if found then
   if prior.operation<>'recipes' or jsonb_typeof(prior.payload) is distinct from 'array' or jsonb_array_length(prior.payload)<>jsonb_array_length(p_payload) then raise exception 'SOURCE_CHANGED';end if;
   if prior.payload<>p_payload then
    for j in 0..jsonb_array_length(p_payload)-1 loop
     if public.recipe_import_text(prior.payload->j->>'name')<>public.recipe_import_text(p_payload->j->>'name') or public.recipe_import_value(prior.payload->j)<>public.recipe_import_value(p_payload->j) or coalesce(prior.payload->j->'imageReferences','[]')<>coalesce(p_payload->j->'imageReferences','[]') then raise exception 'SOURCE_CHANGED';end if;
    end loop;
   end if;
   legacy:=true;
  else
   -- Reserve the original importId with its complete payload. A legacy RPC replay
   -- cannot import an already partially processed source a second time.
   legacy:=not public.claim_request(p_import_id,'recipes',p_payload);
  end if;
  insert into public.recipe_import_sources(user_id,import_id,payload,legacy) values(auth.uid(),p_import_id,p_payload,legacy);
 end if;
 select * into done from public.recipe_import_items where user_id=auth.uid() and import_id=p_import_id and item_index=p_index;
 if found then return jsonb_build_object('status','skipped','reason','already','recipeId',done.recipe_id,'versionId',done.version_id);end if;
 item:=p_payload->p_index;
 perform public.validate_recipe(item);
 if legacy then
  select v.recipe_id,v.id into root,version_id from public.recipe_versions v where v.user_id=auth.uid() and v.version=1 and public.recipe_import_text(v.name)=public.recipe_import_text(item->>'name') and public.recipe_import_value(to_jsonb(v)||coalesce(v.metadata,'{}'))=public.recipe_import_value(item) order by v.created_at limit 1;
  insert into public.recipe_import_items(user_id,import_id,item_index,recipe_id,version_id,outcome) values(auth.uid(),p_import_id,p_index,root,version_id,'legacy');
  return jsonb_build_object('status','skipped','reason','already','recipeId',root,'versionId',version_id);
 end if;
 select v.recipe_id,r.archived into match_id,match_archived from public.recipe_versions v join public.recipes r on r.id=v.recipe_id where v.user_id=auth.uid() and (public.recipe_import_text(v.name)=public.recipe_import_text(item->>'name') or public.recipe_import_value(to_jsonb(v)||coalesce(v.metadata,'{}'))=public.recipe_import_value(item)) order by r.archived,v.version desc limit 1;
 if p_mode='new' and match_id is not null then return jsonb_build_object('status','duplicate','reason',case when match_archived then 'archived' else 'existing' end,'recipeId',case when match_archived then null else match_id end);end if;
 child:=gen_random_uuid();
 if p_mode='version' then
  select * into target from public.recipe_versions where id=p_target and user_id=auth.uid();
  if not found then raise exception 'TARGET_NOT_FOUND';end if;
  if not exists(select 1 from public.recipe_versions v where v.user_id=auth.uid() and v.recipe_id=target.recipe_id and (public.recipe_import_text(v.name)=public.recipe_import_text(item->>'name') or public.recipe_import_value(to_jsonb(v)||coalesce(v.metadata,'{}'))=public.recipe_import_value(item))) then raise exception 'TARGET_NOT_MATCHING';end if;
  perform public.revise_recipe(p_target,child,item);
  root:=target.recipe_id;
  select id into version_id from public.recipe_versions where recipe_id=root order by version desc limit 1;
  if item ? 'imageReferences' then
   if jsonb_typeof(item->'imageReferences') is distinct from 'array' or jsonb_array_length(item->'imageReferences')>8 then raise exception 'Invalid image references';end if;
   for reference in select value from jsonb_array_elements(item->'imageReferences') loop
    if coalesce(reference->>'sourceUrl','') not like 'https://%' or coalesce(length(reference->>'alt'),0) not between 1 and 300 or coalesce(length(reference->>'author'),0) not between 1 and 200 or coalesce(length(reference->>'license'),0) not between 1 and 300 then raise exception 'Invalid image reference';end if;
    insert into public.recipe_image_references(user_id,recipe_id,reference) select auth.uid(),root,reference where not exists(select 1 from public.recipe_image_references x where x.user_id=auth.uid() and x.recipe_id=root and x.reference=reference);
   end loop;
  end if;
 else
  select coalesce(array_agg(id),'{}') into before_ids from public.recipes where user_id=auth.uid();
  perform public.import_recipes(child,jsonb_build_array(item));
  select v.recipe_id,v.id into root,version_id from public.recipe_versions v where v.user_id=auth.uid() and not(v.recipe_id=any(before_ids)) and v.name=item->>'name' and public.recipe_import_value(to_jsonb(v)||coalesce(v.metadata,'{}'))=public.recipe_import_value(item) order by v.created_at desc limit 1;
  if root is null then raise exception 'IMPORT_RESULT_MISSING';end if;
 end if;
 insert into public.recipe_import_items(user_id,import_id,item_index,recipe_id,version_id,outcome) values(auth.uid(),p_import_id,p_index,root,version_id,case p_mode when 'version' then 'version' else 'added' end);
 return jsonb_build_object('status',case p_mode when 'version' then 'version' else 'added' end,'recipeId',root,'versionId',version_id);
end $$;
revoke all on function public.recipe_import_text(text),public.recipe_import_value(jsonb),public.import_recipe_item(uuid,jsonb,integer,text,uuid) from public,anon;
grant execute on function public.recipe_import_text(text),public.recipe_import_value(jsonb),public.import_recipe_item(uuid,jsonb,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
select to_regclass('public.recipe_import_sources') is not null as import_sources_ready,to_regclass('public.recipe_import_items') is not null as import_items_ready;
