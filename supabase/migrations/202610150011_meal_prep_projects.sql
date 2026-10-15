-- AI meal-prep projects reuse recipes, shopping plans, calendar and portioning.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin if to_regclass('public.meal_plan_components') is null or to_regprocedure('public.save_meal_schedule(uuid,jsonb,jsonb,boolean)') is null then raise exception 'Activate migration 010 before 011';end if;end $$;
create table public.meal_prep_projects(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,
 import_id uuid not null,source jsonb not null,name text not null check(length(name) between 1 and 160),
 description text not null,cooking_date date not null,days integer not null check(days between 1 and 14),
 target_portions integer not null check(target_portions between 1 and 500),
 status text not null default 'planned' check(status in('planned','purchased','cooking','cooked','frozen')),
 shopping_plan_id uuid not null unique references public.shopping_plans,initialised boolean not null default false,
 revision integer not null default 0,created_at timestamptz not null default now(),unique(user_id,import_id)
);
create table public.meal_prep_project_recipes(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,
 project_id uuid not null references public.meal_prep_projects on delete cascade,local_key text not null check(local_key ~ '^[a-z][a-z0-9_-]{0,49}$'),
 recipe_version_id uuid not null references public.recipe_versions,portions numeric(8,2) not null check(portions>0 and portions<=100),details jsonb,
 unique(project_id,local_key)
);
create table public.meal_prep_calendar_links(user_id uuid not null references auth.users on delete cascade,project_id uuid not null references public.meal_prep_projects on delete cascade,entry_id uuid not null references public.meal_plan_entries on delete cascade,primary key(project_id,entry_id));
create table public.meal_prep_batch_links(user_id uuid not null references auth.users on delete cascade,project_id uuid not null references public.meal_prep_projects on delete cascade,project_recipe_id uuid not null references public.meal_prep_project_recipes, batch_id uuid primary key references public.cooking_batches,actual_portions numeric(8,2) not null check(actual_portions>0 and actual_portions<=100));
create index on public.meal_prep_projects(user_id,created_at);
create index on public.meal_prep_project_recipes(user_id,project_id);
do $$ declare t text;begin foreach t in array array['meal_prep_projects','meal_prep_project_recipes','meal_prep_calendar_links','meal_prep_batch_links'] loop execute format('alter table public.%I enable row level security',t);execute format('create policy own_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create function public.import_meal_prep(p_document jsonb,p_keys jsonb,p_reuse jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare project public.meal_prep_projects;item jsonb;payload jsonb;version public.recipe_versions;root uuid;new_source uuid;result jsonb;plan_id uuid;side_ids jsonb;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8008));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
 if p_document->>'format' is distinct from 'freezeros.mealprep.v1' or octet_length(p_document::text)>4000000 or jsonb_typeof(p_document->'recipes') is distinct from 'array' or jsonb_array_length(p_document->'recipes') not between 1 and 50 or jsonb_typeof(p_keys) is distinct from 'array' or jsonb_array_length(p_keys) not between 1 and 50 or jsonb_typeof(p_reuse) is distinct from 'object' then raise exception 'Invalid meal prep';end if;
 select * into project from public.meal_prep_projects where user_id=auth.uid() and import_id=(p_document->>'importId')::uuid;
 if found then if project.source<>p_document then raise exception 'SOURCE_CHANGED';end if;return project.id;end if;
 if exists(select 1 from jsonb_array_elements_text(p_keys) k where not exists(select 1 from jsonb_array_elements(p_document->'recipes') r where r->>'key'=k)) or exists(select 1 from jsonb_array_elements(p_document->'recipes') r group by r->>'key' having count(*)>1) then raise exception 'Invalid recipe keys';end if;
 plan_id:=gen_random_uuid();
 perform public.save_shopping_plan(gen_random_uuid(),jsonb_build_object('id',plan_id,'name',p_document->>'name','status','draft','recipes','[]'::jsonb,'items','[]'::jsonb));
 insert into public.meal_prep_projects(user_id,import_id,source,name,description,cooking_date,days,target_portions,shopping_plan_id) values(auth.uid(),(p_document->>'importId')::uuid,p_document,p_document->>'name',p_document->>'description',(p_document->>'cooking_date')::date,(p_document->>'days')::int,(p_document->>'target_portions')::int,plan_id) returning * into project;
 -- Dependencies are side/component recipes; import them before main recipes.
 for item in select r from jsonb_array_elements(p_document->'recipes') r where p_keys ? (r->>'key') order by case when r->'recipe'->>'meal_role'='main' then 1 else 0 end,r->>'key' loop
 payload:=item->'recipe';perform public.validate_recipe(payload);perform public.recipe_metadata(payload);
 if p_reuse ? (item->>'key') then
 select * into version from public.recipe_versions where id=(p_reuse->>(item->>'key'))::uuid and user_id=auth.uid();
 if not found then raise exception 'Invalid reused recipe owner';end if;
 else
 select v.* into version from public.recipe_versions v join public.recipes r on r.id=v.recipe_id where v.user_id=auth.uid() and not r.archived and public.recipe_import_value(to_jsonb(v)||coalesce(v.metadata,'{}'))=public.recipe_import_value(payload) order by v.version desc limit 1;
 if not found then
 if exists(select 1 from public.recipe_versions v where v.user_id=auth.uid() and public.recipe_import_text(v.name)=public.recipe_import_text(payload->>'name')) then raise exception 'DUPLICATE_REVIEW: choose an existing version or skip this recipe';end if;
 select coalesce(jsonb_agg(v.recipe_id),'[]') into side_ids from public.meal_prep_project_recipes pr join public.recipe_versions v on v.id=pr.recipe_version_id where pr.project_id=project.id and coalesce(item->'compatible_sides','[]') ? pr.local_key;
 if payload->>'side_policy'='required' and jsonb_array_length(side_ids)=0 then raise exception 'Choose required side recipes';end if;
 payload:=payload||jsonb_build_object('compatible_side_ids',side_ids);
 new_source:=md5(project.import_id::text||':mealprep:'||(item->>'key'))::uuid;
 result:=public.import_recipe_item(new_source,jsonb_build_array(payload),0,'new');
 if result->>'status' is distinct from 'added' then raise exception 'DUPLICATE_REVIEW';end if;
 select * into version from public.recipe_versions where id=(result->>'versionId')::uuid and user_id=auth.uid();
 end if;
 end if;
 insert into public.meal_prep_project_recipes(user_id,project_id,local_key,recipe_version_id,portions,details) values(auth.uid(),project.id,item->>'key',version.id,(item->>'planned_portions')::numeric,case when public.recipe_import_value(to_jsonb(version)||coalesce(version.metadata,'{}'))=public.recipe_import_value(item->'recipe') then item else null end);
 end loop;
 insert into public.planning_audit(user_id,entity_id,operation,after_data) values(auth.uid(),project.id,'meal_prep_import',jsonb_build_object('importId',project.import_id,'keys',p_keys));return project.id;
end $$;
-- Project-linked shopping is edited atomically through its owning project.
create function public.guard_meal_prep_shopping() returns trigger language plpgsql security definer set search_path='' as $$ declare pid uuid;begin
 if TG_OP='DELETE' then pid:=old.plan_id;else pid:=new.plan_id;end if;
 if auth.uid() is not null and exists(select 1 from public.meal_prep_projects p where p.shopping_plan_id=pid and p.id::text is distinct from current_setting('freezer.meal_prep_write',true)) then raise exception 'PROJECT_USE_MEAL_PREP';end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_meal_prep_shopping() from public,anon,authenticated;
create trigger meal_prep_recipes_guard before insert or update or delete on public.shopping_plan_recipes for each row execute function public.guard_meal_prep_shopping();
create trigger meal_prep_items_guard before insert or update or delete on public.shopping_plan_items for each row execute function public.guard_meal_prep_shopping();
create function public.edit_meal_prep(p_request uuid,p_id uuid,p_revision integer,p_rows jsonb,p_plan jsonb,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare project public.meal_prep_projects;item jsonb;prior public.meal_prep_project_recipes;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
 if not public.claim_request(p_request,'mealprep-edit011',jsonb_build_array(p_id,p_revision,p_rows,p_plan,p_status)) then return;end if;
 select * into project from public.meal_prep_projects where id=p_id and user_id=auth.uid() for update;if not found then raise exception 'Project not found';end if;
 if project.revision is distinct from p_revision then raise exception 'REVISION_CONFLICT';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 or exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'local_key' having count(*)>1) then raise exception 'Invalid project recipes';end if;
 if (p_plan->>'id')::uuid<>project.shopping_plan_id then raise exception 'Invalid project shopping';end if;
 if project.status<>'planned' and p_rows is distinct from (select jsonb_agg(jsonb_build_object('id',r.id,'local_key',r.local_key,'recipe_version_id',r.recipe_version_id,'portions',r.portions) order by r.id) from public.meal_prep_project_recipes r where r.project_id=p_id) then raise exception 'PURCHASED_PROJECT_LOCKED';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where not exists(select 1 from public.recipe_versions v where v.id=(r->>'recipe_version_id')::uuid and v.user_id=auth.uid())) then raise exception 'Invalid recipe owner';end if;
 if (select count(*) from jsonb_array_elements(p_plan->'recipes'))<>jsonb_array_length(p_rows) or exists(select 1 from jsonb_array_elements(p_rows) r where not exists(select 1 from jsonb_array_elements(p_plan->'recipes') c where c->>'id'=r->>'id' and c->>'recipe_version_id'=r->>'recipe_version_id' and (c->>'portions')::numeric=(r->>'portions')::numeric and (c->>'from_freezer')::numeric=0 and c->>'meal_entry_id' is null)) then raise exception 'Project shopping mismatch';end if;
 perform set_config('freezer.meal_prep_write',p_id::text,true);
 perform public.save_shopping_plan(gen_random_uuid(),p_plan);
 for item in select value from jsonb_array_elements(p_rows) loop
 select * into prior from public.meal_prep_project_recipes where id=(item->>'id')::uuid and project_id=p_id and user_id=auth.uid();
 if exists(select 1 from public.meal_prep_batch_links where project_recipe_id=prior.id) and prior.recipe_version_id<>(item->>'recipe_version_id')::uuid then raise exception 'ACTUAL_BATCH_LINKED';end if;
 if prior.id is null and exists(select 1 from public.meal_prep_project_recipes where id=(item->>'id')::uuid) then raise exception 'Invalid recipe row';end if;
 insert into public.meal_prep_project_recipes(id,user_id,project_id,local_key,recipe_version_id,portions,details) values((item->>'id')::uuid,auth.uid(),p_id,item->>'local_key',(item->>'recipe_version_id')::uuid,(item->>'portions')::numeric,null) on conflict(id) do update set local_key=excluded.local_key,recipe_version_id=excluded.recipe_version_id,portions=excluded.portions,details=case when public.meal_prep_project_recipes.recipe_version_id=excluded.recipe_version_id then public.meal_prep_project_recipes.details else null end;
 end loop;
 delete from public.meal_prep_project_recipes where project_id=p_id and user_id=auth.uid() and id not in(select (r->>'id')::uuid from jsonb_array_elements(p_rows) r);
 update public.meal_prep_projects set status=p_status,revision=revision+1,initialised=true where id=p_id;
 insert into public.planning_audit(user_id,entity_id,operation,before_data,after_data) values(auth.uid(),p_id,'meal_prep_edit',to_jsonb(project),jsonb_build_object('recipes',p_rows,'status',p_status));
end $$;
create function public.apply_meal_prep_calendar(p_request uuid,p_id uuid,p_revision integer,p_changes jsonb,p_batches jsonb) returns void language plpgsql security definer set search_path='' as $$ declare project public.meal_prep_projects;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
 if not public.claim_request(p_request,'mealprep-calendar011',jsonb_build_array(p_id,p_revision,p_changes,p_batches)) then return;end if;
 select * into project from public.meal_prep_projects where id=p_id and user_id=auth.uid() for update;if not found then raise exception 'Project not found';end if;
 if project.revision is distinct from p_revision then raise exception 'REVISION_CONFLICT';end if;
 if exists(select 1 from public.meal_prep_calendar_links where project_id=p_id) then raise exception 'CALENDAR_ALREADY_APPLIED';end if;
 if jsonb_array_length(p_changes)=0 then raise exception 'No meals to apply';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) c where not exists(select 1 from public.meal_prep_project_recipes r where r.project_id=p_id and r.recipe_version_id=(c->>'recipe_version_id')::uuid) or c->>'revision' is not null or coalesce((c->>'remove')::boolean,false) or exists(select 1 from public.meal_plan_entries e where e.user_id=auth.uid() and e.meal_date=(c->>'meal_date')::date and e.slot=c->>'slot')) then raise exception 'CALENDAR_CONFLICT';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) c,jsonb_array_elements(coalesce(c->'components','[]')) s where not exists(select 1 from public.meal_prep_project_recipes r where r.project_id=p_id and r.recipe_version_id=(s->>'recipe_version_id')::uuid)) then raise exception 'Invalid project side';end if;
 perform public.save_meal_schedule(gen_random_uuid(),p_changes,p_batches,true);
 insert into public.meal_prep_calendar_links(user_id,project_id,entry_id) select auth.uid(),p_id,(c->>'id')::uuid from jsonb_array_elements(p_changes) c;
 insert into public.planning_audit(user_id,entity_id,operation,after_data) values(auth.uid(),p_id,'meal_prep_calendar',p_changes);
end $$;
create function public.link_meal_prep_batch(p_request uuid,p_id uuid,p_row uuid,p_batch uuid,p_portions numeric) returns void language plpgsql security definer set search_path='' as $$ begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'mealprep-batch011',jsonb_build_array(p_id,p_row,p_batch,p_portions)) then return;end if;
if not exists(select 1 from public.meal_prep_project_recipes pr join public.cooking_batches cb on cb.recipe_version_id=pr.recipe_version_id where pr.id=p_row and pr.project_id=p_id and pr.user_id=auth.uid() and cb.id=p_batch and cb.user_id=auth.uid()) then raise exception 'Invalid actual batch';end if;
if exists(select 1 from public.meal_prep_batch_links where batch_id=p_batch) then raise exception 'Batch already linked';end if;
insert into public.meal_prep_batch_links values(auth.uid(),p_id,p_row,p_batch,p_portions);
insert into public.planning_audit(user_id,entity_id,operation,after_data) values(auth.uid(),p_id,'meal_prep_actual_batch',jsonb_build_object('batch_id',p_batch,'actual_portions',p_portions));
end $$;
revoke all on function public.link_meal_prep_batch(uuid,uuid,uuid,uuid,numeric) from public,anon;
grant execute on function public.link_meal_prep_batch(uuid,uuid,uuid,uuid,numeric) to authenticated;
revoke all on function public.import_meal_prep(jsonb,jsonb,jsonb),public.edit_meal_prep(uuid,uuid,integer,jsonb,jsonb,text),public.apply_meal_prep_calendar(uuid,uuid,integer,jsonb,jsonb) from public,anon;
grant execute on function public.import_meal_prep(jsonb,jsonb,jsonb),public.edit_meal_prep(uuid,uuid,integer,jsonb,jsonb,text),public.apply_meal_prep_calendar(uuid,uuid,integer,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
select to_regclass('public.meal_prep_projects') is not null as meal_preps_ready,to_regclass('public.meal_prep_project_recipes') is not null as project_recipes_ready,to_regprocedure('public.import_meal_prep(jsonb,jsonb,jsonb)') is not null as meal_prep_import_ready;
