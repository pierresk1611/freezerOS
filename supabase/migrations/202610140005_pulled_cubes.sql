-- Additive extension: existing stock, snapshots and IDs remain untouched.
alter table public.recipe_versions add column metadata jsonb;
create function public.recipe_metadata(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare m jsonb; k text;
begin
 if p ? 'category' and (jsonb_typeof(p->'category') is distinct from 'string' or p->>'category' not in('general','slow_roasted_pulled_meat')) then raise exception 'Invalid category'; end if;
 if p ? 'cooking_method' and (jsonb_typeof(p->'cooking_method') is distinct from 'string' or p->>'cooking_method' not in('oven','stove','slow_roast')) then raise exception 'Invalid cooking method'; end if;
 foreach k in array array['prep_minutes','cooking_minutes_min','cooking_minutes_max','oven_c'] loop
 if p ? k and (jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric<>trunc((p->>k)::numeric) or (p->>k)::numeric not between 1 and 2880) then raise exception 'Invalid cooking metadata'; end if;
 end loop;
 if p ? 'prep_minutes' and (p->>'prep_minutes')::integer>1440 then raise exception 'Invalid preparation time'; end if;
 if p ? 'oven_c' and (p->>'oven_c')::integer not between 50 and 300 then raise exception 'Invalid oven temperature'; end if;
 if p ? 'cooking_minutes_min' and p ? 'cooking_minutes_max' and (p->>'cooking_minutes_max')::integer<(p->>'cooking_minutes_min')::integer then raise exception 'Invalid cooking interval'; end if;
 select jsonb_object_agg(key,value) into m from jsonb_each(p) where key=any(array['category','cooking_method','prep_minutes','cooking_minutes_min','cooking_minutes_max','oven_c']);
 return m;
end $$;
revoke all on function public.recipe_metadata(jsonb) from public,anon,authenticated;
create or replace function public.import_recipes(p_import_id uuid,p_recipes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; ingredient jsonb; step jsonb; recipe uuid; reference jsonb;
begin
 if not public.claim_request(p_import_id,'recipes',p_recipes) then return; end if;
 if jsonb_typeof(p_recipes)<>'array' or jsonb_array_length(p_recipes) not between 1 and 50 then raise exception 'Invalid recipes'; end if;
 for item in select value from jsonb_array_elements(p_recipes) loop
 perform public.validate_recipe(item);
 insert into public.recipes(user_id) values(auth.uid()) returning id into recipe;
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing,metadata)
 values(recipe,auth.uid(),1,item->>'name',(item->>'portions')::integer,item->'ingredients',item->'steps',item->>'reheating',coalesce(item->>'meat','none'),coalesce(item->>'storage','Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.'),coalesce((item->>'freezing')::boolean,true),public.recipe_metadata(item));
 if item ? 'imageReferences' then
 if jsonb_typeof(item->'imageReferences') is distinct from 'array' or jsonb_array_length(item->'imageReferences')>8 then raise exception 'Invalid image references'; end if;
 for reference in select value from jsonb_array_elements(item->'imageReferences') loop
 if coalesce(reference->>'sourceUrl','') not like 'https://%' or coalesce(length(reference->>'alt'),0) not between 1 and 300 or coalesce(length(reference->>'author'),0) not between 1 and 200 or coalesce(length(reference->>'license'),0) not between 1 and 300 then raise exception 'Invalid image reference'; end if;
 insert into public.recipe_image_references(recipe_id,user_id,reference) values(recipe,auth.uid(),reference);
 end loop;
 end if;
 end loop;
end $$;
create or replace function public.revise_recipe(p_version_id uuid,p_request_id uuid,p_recipe jsonb) returns void language plpgsql security definer set search_path='' as $$
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
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing,metadata)
 values(previous.recipe_id,auth.uid(),next_version,p_recipe->>'name',(p_recipe->>'portions')::integer,p_recipe->'ingredients',p_recipe->'steps',p_recipe->>'reheating',coalesce(p_recipe->>'meat','none'),coalesce(p_recipe->>'storage','Rýchlo schlaďte.'),coalesce((p_recipe->>'freezing')::boolean,true),public.recipe_metadata(p_recipe));
end $$;
create or replace function public.create_recipe_with_id(p_id uuid,p_recipe jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.claim_request(p_id,'create_recipe',p_recipe) then return; end if;
 perform public.validate_recipe(p_recipe);
 insert into public.recipes(id,user_id) values(p_id,auth.uid());
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing,metadata)
 values(p_id,auth.uid(),1,p_recipe->>'name',(p_recipe->>'portions')::integer,p_recipe->'ingredients',p_recipe->'steps',p_recipe->>'reheating',coalesce(p_recipe->>'meat','none'),coalesce(p_recipe->>'storage','Rýchlo schlaďte.'),coalesce((p_recipe->>'freezing')::boolean,true),public.recipe_metadata(p_recipe));
end $$;
create or replace view public.recipe_latest with (security_invoker=true) as select distinct on(v.recipe_id) v.* from public.recipe_versions v join public.recipes r on r.id=v.recipe_id where not r.archived order by v.recipe_id,v.version desc;
create table public.food_preferences(user_id uuid primary key references auth.users(id) on delete cascade, favorites text[] not null default '{}', combinations text[] not null default '{}',updated_at timestamptz not null default now(),check(cardinality(favorites)<=30 and cardinality(combinations)<=30));
alter table public.food_preferences enable row level security;
create policy preference_owner on public.food_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.food_preferences from anon;grant select,insert,update,delete on public.food_preferences to authenticated;
create table public.portion_molds(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 100),cells integer not null check(cells between 1 and 30),cell_ml integer not null check(cell_ml between 1 and 2000),owned_count integer not null check(owned_count between 1 and 100));
create unique index portion_molds_identity on public.portion_molds(user_id,name,cells,cell_ml);
alter table public.portion_molds enable row level security;
create policy mold_owner on public.portion_molds for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.portion_molds from anon;grant select,insert,update,delete on public.portion_molds to authenticated;
alter table public.cooking_batches add column portion_status text not null default 'legacy' check(portion_status in('legacy','cooling','frozen','packed')),add column manufactured_on date,add column frozen_on date,add column quality_until date;
alter table public.inventory_packages add column portions numeric(8,2) check(portions>0),add column cube_count integer check(cube_count>0),add column volume_ml integer check(volume_ml>0),add column manufactured_on date,add column frozen_on date;
create table public.batch_cubes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,batch_id uuid not null references public.cooking_batches(id) on delete cascade,mold_id uuid not null references public.portion_molds(id),cube_index integer not null check(cube_index>=0),weight_g integer not null check(weight_g>0),volume_ml integer not null check(volume_ml>0),package_id uuid references public.inventory_packages(id),unique(batch_id,cube_index));
alter table public.batch_cubes enable row level security;
create policy cube_owner on public.batch_cubes for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.batch_cubes from anon,authenticated;grant select on public.batch_cubes to authenticated;
create function public.start_cube_batch(p_id uuid,p_version uuid,p_weight integer,p_cost bigint,p_made date,p_quality date,p_cubes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; m public.portion_molds; r public.recipe_versions; total integer:=0;i integer:=0; used integer;
begin
 if not public.claim_request(p_id,'cube_batch',jsonb_build_array(p_version,p_weight,p_cost,p_made,p_quality,p_cubes)) then return; end if;
 select * into r from public.recipe_versions where id=p_version and user_id=auth.uid();
 if not found or not r.freezing then raise exception 'Recipe unavailable or unsuitable'; end if;
 if p_weight is null or p_weight not between 1 and 1000000 or p_cost<0 or p_cost>100000000 or p_made is null or p_quality is null or p_quality<p_made or jsonb_typeof(p_cubes) is distinct from 'array' or jsonb_array_length(p_cubes) not between 1 and 200 then raise exception 'Invalid batch'; end if;
 insert into public.cooking_batches(id,user_id,recipe_version_id,weight_g,cost_minor,portion_status,manufactured_on,quality_until) values(p_id,auth.uid(),p_version,p_weight,p_cost,'cooling',p_made,p_quality);
 for item in select value from jsonb_array_elements(p_cubes) loop
 select * into m from public.portion_molds where id=(item->>'mold_id')::uuid and user_id=auth.uid() for update;
 if not found then raise exception 'Mold not owned'; end if;
 if jsonb_typeof(item->'weight_g') is distinct from 'number' or jsonb_typeof(item->'volume_ml') is distinct from 'number' or (item->>'weight_g')::numeric<>trunc((item->>'weight_g')::numeric) or (item->>'volume_ml')::numeric<>trunc((item->>'volume_ml')::numeric) or (item->>'weight_g')::integer not between 1 and 1000000 or (item->>'volume_ml')::integer not between 1 and m.cell_ml then raise exception 'Invalid cube'; end if;
 select count(*) into used from public.batch_cubes c join public.cooking_batches b on b.id=c.batch_id where c.mold_id=m.id and b.portion_status in('cooling','frozen');
 if used>=m.cells*m.owned_count then raise exception 'Mold capacity exceeded'; end if;
 insert into public.batch_cubes(user_id,batch_id,mold_id,cube_index,weight_g,volume_ml) values(auth.uid(),p_id,m.id,i,(item->>'weight_g')::integer,(item->>'volume_ml')::integer);
 total:=total+(item->>'weight_g')::integer;i:=i+1;
 end loop;
 if total<>p_weight then raise exception 'Weight balance mismatch'; end if;
end $$;
create function public.freeze_cube_batch(p_batch uuid,p_request uuid,p_frozen date) returns void language plpgsql security definer set search_path='' as $$
declare b public.cooking_batches;
begin
 if not public.claim_request(p_request,'freeze_cubes',jsonb_build_array(p_batch,p_frozen)) then return; end if;
 select * into b from public.cooking_batches where id=p_batch and user_id=auth.uid() for update;
 if not found or b.portion_status<>'cooling' or p_frozen is null or p_frozen<b.manufactured_on or p_frozen>b.quality_until then raise exception 'Invalid freezing'; end if;
 update public.cooking_batches set portion_status='frozen',frozen_on=p_frozen where id=p_batch;
end $$;
create function public.pack_cube_batch(p_batch uuid,p_request uuid,p_packages jsonb) returns void language plpgsql security definer set search_path='' as $$
declare b public.cooking_batches; item jsonb; idx jsonb; cube public.batch_cubes; seen integer[]:='{}'; indexes integer[]; w integer; vol integer; n integer; total integer:=0; allocated bigint:=0; cost bigint; pkg uuid; name text; position integer:=0; count_packages integer;
begin
 if not public.claim_request(p_request,'pack_cubes',jsonb_build_array(p_batch,p_packages)) then return; end if;
 select * into b from public.cooking_batches where id=p_batch and user_id=auth.uid() for update;
 if not found or b.portion_status<>'frozen' then raise exception 'Batch already packed or not frozen'; end if;
 if jsonb_typeof(p_packages) is distinct from 'array' or jsonb_array_length(p_packages) not between 1 and 100 then raise exception 'Invalid packages'; end if;
 select v.name into name from public.recipe_versions v where v.id=b.recipe_version_id;
 count_packages:=jsonb_array_length(p_packages);
 for item in select value from jsonb_array_elements(p_packages) loop
 if jsonb_typeof(item->'cubes') is distinct from 'array' or jsonb_array_length(item->'cubes')=0 or jsonb_typeof(item->'portions') is distinct from 'number' or (item->>'portions')::numeric not between 0.01 and 100 or (item->>'portions')::numeric<>round((item->>'portions')::numeric,2) then raise exception 'Invalid portioning'; end if;
 if item->>'location_id' is not null and not exists(select 1 from public.storage_locations where id=(item->>'location_id')::uuid and user_id=auth.uid()) then raise exception 'Foreign location'; end if;
 w:=0;vol:=0;n:=0;indexes:='{}';
 for idx in select value from jsonb_array_elements(item->'cubes') loop
 if jsonb_typeof(idx) is distinct from 'number' or (idx#>>'{}')::numeric<>trunc((idx#>>'{}')::numeric) or (idx#>>'{}')::integer=any(seen) then raise exception 'Duplicate or invalid cube'; end if;
 select * into cube from public.batch_cubes where batch_id=p_batch and cube_index=(idx#>>'{}')::integer and user_id=auth.uid() and package_id is null;
 if not found then raise exception 'Cube not available'; end if;
 seen:=array_append(seen,cube.cube_index);indexes:=array_append(indexes,cube.cube_index);w:=w+cube.weight_g;vol:=vol+cube.volume_ml;n:=n+1;
 end loop;
 position:=position+1;
 cost:=case when b.cost_minor is null then null when position=count_packages then b.cost_minor-allocated else floor(b.cost_minor::numeric*w/b.weight_g)::bigint end;
 if cost<0 then raise exception 'Invalid cost allocation'; end if;
 allocated:=allocated+coalesce(cost,0);
 insert into public.inventory_packages(user_id,batch_id,name,initial_g,remaining_g,cost_minor,location_id,best_before,portions,cube_count,volume_ml,manufactured_on,frozen_on) values(auth.uid(),p_batch,name,w,w,cost,(item->>'location_id')::uuid,b.quality_until,(item->>'portions')::numeric,n,vol,b.manufactured_on,b.frozen_on) returning id into pkg;
 update public.batch_cubes set package_id=pkg where batch_id=p_batch and cube_index=any(indexes);
 insert into public.inventory_movements(user_id,package_id,request_id,type,delta_g) values(auth.uid(),pkg,p_request,'receive',w);
 total:=total+w;
 end loop;
 if total<>b.weight_g or cardinality(seen)<>(select count(*) from public.batch_cubes where batch_id=p_batch) or (b.cost_minor is not null and allocated<>b.cost_minor) then raise exception 'Batch balance mismatch'; end if;
 update public.cooking_batches set portion_status='packed' where id=p_batch;
end $$;
revoke all on function public.start_cube_batch(uuid,uuid,integer,bigint,date,date,jsonb),public.freeze_cube_batch(uuid,uuid,date),public.pack_cube_batch(uuid,uuid,jsonb) from public,anon;
grant execute on function public.start_cube_batch(uuid,uuid,integer,bigint,date,date,jsonb),public.freeze_cube_batch(uuid,uuid,date),public.pack_cube_batch(uuid,uuid,jsonb) to authenticated;
create table public.meal_plan_entries(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,recipe_version_id uuid not null references public.recipe_versions(id),meal_date date not null,slot text not null check(slot in('breakfast','lunch','dinner','snack')),portions numeric(8,2) not null check(portions between 0.01 and 100),created_at timestamptz not null default now());
alter table public.meal_plan_entries enable row level security;
create policy plan_owner on public.meal_plan_entries for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.recipe_versions where id=recipe_version_id and user_id=(select auth.uid())));
revoke all on public.meal_plan_entries from anon;grant select,insert,delete on public.meal_plan_entries to authenticated;

create function public.check_mold_ownership_capacity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.cells*new.owned_count < (select count(*) from public.batch_cubes c join public.cooking_batches b on b.id=c.batch_id where c.mold_id=old.id and b.portion_status in('cooling','frozen')) then raise exception 'Form contains active cubes'; end if;
 return new;
end $$;
create trigger mold_capacity_before_update before update on public.portion_molds for each row execute function public.check_mold_ownership_capacity();
