alter table public.recipes add column archived boolean not null default false;
alter table public.recipe_versions add column meat text not null default 'none' check(meat in('none','beef','pork','chicken','other','fish')),add column storage text not null default 'Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.',add column freezing boolean not null default true;
create function public.validate_recipe(p_recipe jsonb) returns void language plpgsql set search_path='' as $$
declare item jsonb:=p_recipe; ingredient jsonb; step jsonb;
begin
 if length(item->>'name') not between 2 and 160 or (item->>'portions')::integer not between 1 and 100
 or jsonb_typeof(item->'ingredients')<>'array' or jsonb_array_length(item->'ingredients') not between 1 and 100
 or jsonb_typeof(item->'steps')<>'array' or jsonb_array_length(item->'steps') not between 1 and 100
 or coalesce(length(item->>'reheating'),0) not between 1 and 2000 then raise exception 'Invalid recipe'; end if;
 for ingredient in select value from jsonb_array_elements(item->'ingredients') loop
 if coalesce(length(ingredient->>'name'),0) not between 1 and 120 or coalesce((ingredient->>'quantity')::numeric,0)<=0 or coalesce(ingredient->>'unit','') not in('g','ml','ks') then raise exception 'Invalid ingredient'; end if;
 end loop;
 for step in select value from jsonb_array_elements(item->'steps') loop
 if jsonb_typeof(step)<>'string' or length(step#>>'{}') not between 1 and 2000 then raise exception 'Invalid step'; end if;
 end loop;

 if item ? 'meat' and coalesce(item->>'meat','') not in('none','beef','pork','chicken','other','fish') then raise exception 'Invalid meat'; end if;
 if item ? 'storage' and coalesce(length(item->>'storage'),0) not between 1 and 2000 then raise exception 'Invalid storage'; end if;
 if item ? 'freezing' and jsonb_typeof(item->'freezing')<>'boolean' then raise exception 'Invalid freezing flag'; end if;
end $$;
revoke all on function public.validate_recipe(jsonb) from public,anon,authenticated;
create or replace function public.import_recipes(p_import_id uuid,p_recipes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; ingredient jsonb; step jsonb; recipe uuid;
begin
 if not public.claim_request(p_import_id,'recipes',p_recipes) then return; end if;
 if jsonb_typeof(p_recipes)<>'array' or jsonb_array_length(p_recipes) not between 1 and 50 then raise exception 'Invalid recipes'; end if;
 for item in select value from jsonb_array_elements(p_recipes) loop
 perform public.validate_recipe(item);
 insert into public.recipes(user_id) values(auth.uid()) returning id into recipe;
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing)
 values(recipe,auth.uid(),1,item->>'name',(item->>'portions')::integer,item->'ingredients',item->'steps',item->>'reheating',coalesce(item->>'meat','none'),coalesce(item->>'storage','Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.'),coalesce((item->>'freezing')::boolean,true));
 end loop;
end $$;


create function public.revise_recipe(p_version_id uuid,p_request_id uuid,p_recipe jsonb) returns void language plpgsql security definer set search_path='' as $$
declare previous public.recipe_versions; latest uuid; next_version integer;
begin
 if not public.claim_request(p_request_id,'revise_recipe',jsonb_build_array(p_version_id,p_recipe)) then return; end if;
 select * into previous from public.recipe_versions where id=p_version_id and user_id=auth.uid();
 if not found then raise exception 'Recipe not found'; end if;
 perform 1 from public.recipes where id=previous.recipe_id and user_id=auth.uid() and not archived for update;
 if not found then raise exception 'Recipe archived'; end if;
 select id,version+1 into latest,next_version from public.recipe_versions where recipe_id=previous.recipe_id order by version desc limit 1;
 if latest<>p_version_id then raise exception 'Recipe changed since editing'; end if;
 perform public.validate_recipe(p_recipe);
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing)
 values(previous.recipe_id,auth.uid(),next_version,p_recipe->>'name',(p_recipe->>'portions')::integer,p_recipe->'ingredients',p_recipe->'steps',p_recipe->>'reheating',coalesce(p_recipe->>'meat','none'),coalesce(p_recipe->>'storage','Rýchlo schlaďte.'),coalesce((p_recipe->>'freezing')::boolean,true));
end $$;
create function public.archive_recipe(p_recipe_id uuid,p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.claim_request(p_request_id,'archive_recipe',jsonb_build_array(p_recipe_id)) then return; end if;
 update public.recipes set archived=true where id=p_recipe_id and user_id=auth.uid();
 if not found then raise exception 'Recipe not found'; end if;
end $$;
revoke all on function public.revise_recipe(uuid,uuid,jsonb),public.archive_recipe(uuid,uuid) from public,anon;
grant execute on function public.revise_recipe(uuid,uuid,jsonb),public.archive_recipe(uuid,uuid) to authenticated;
create view public.recipe_latest with (security_invoker=true) as select distinct on(v.recipe_id) v.* from public.recipe_versions v join public.recipes r on r.id=v.recipe_id where not r.archived order by v.recipe_id,v.version desc;
revoke all on public.recipe_latest from public,anon;
grant select on public.recipe_latest to authenticated;
create or replace function public.create_batch(p_version_id uuid,p_request_id uuid,p_weight_g integer,p_package_count integer,p_cost_minor bigint,p_best_before date) returns void language plpgsql security definer set search_path='' as $$
declare recipe public.recipe_versions; batch uuid; package uuid; i integer; package_cost bigint;
begin
 if not public.claim_request(p_request_id,'batch',jsonb_build_array(p_version_id,p_weight_g,p_package_count,p_cost_minor,p_best_before)) then return; end if;
 select * into recipe from public.recipe_versions where id=p_version_id and user_id=auth.uid();
 if not found then raise exception 'Recipe not found'; end if;
 if not recipe.freezing then raise exception 'Recipe unsuitable for freezing'; end if;
 if p_weight_g is null or p_weight_g<=0 or p_weight_g>1000000 or p_package_count is null or p_package_count not between 1 and 100 or p_weight_g%p_package_count<>0 or p_cost_minor<0 or p_cost_minor>100000000 or p_best_before is null then raise exception 'Invalid batch, weight must divide equally'; end if;
 insert into public.cooking_batches(user_id,recipe_version_id,weight_g,cost_minor) values(auth.uid(),p_version_id,p_weight_g,p_cost_minor) returning id into batch;
 for i in 1..p_package_count loop
 package_cost := case when p_cost_minor is null then null else (p_cost_minor/p_package_count) + case when i<=p_cost_minor%p_package_count then 1 else 0 end end;
 insert into public.inventory_packages(user_id,batch_id,name,initial_g,remaining_g,cost_minor,best_before) values(auth.uid(),batch,recipe.name,p_weight_g/p_package_count,p_weight_g/p_package_count,package_cost,p_best_before) returning id into package;
 insert into public.inventory_movements(user_id,package_id,request_id,type,delta_g) values(auth.uid(),package,p_request_id,'receive',p_weight_g/p_package_count);
 end loop;
end $$;
