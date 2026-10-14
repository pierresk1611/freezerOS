-- Immutable recipe versions, batch snapshots and stock ledger. Currency is CZK minor units.
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now());
create table public.recipes (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create table public.recipe_versions (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id), user_id uuid not null references auth.users(id) on delete cascade,
 version integer not null check(version>0), name text not null check(length(name) between 2 and 160), portions integer not null check(portions between 1 and 100),
 ingredients jsonb not null check(jsonb_typeof(ingredients)='array' and jsonb_array_length(ingredients)>0),
 steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps)>0), reheating text not null check(length(reheating)>0), created_at timestamptz not null default now(), unique(recipe_id,version)
);
create table public.storage_locations (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 100),created_at timestamptz not null default now());
create table public.cooking_batches (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,recipe_version_id uuid not null references public.recipe_versions(id),weight_g integer not null check(weight_g>0),cost_minor bigint check(cost_minor>=0),created_at timestamptz not null default now());
create table public.inventory_packages (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,batch_id uuid not null references public.cooking_batches(id),name text not null,
 initial_g integer not null check(initial_g>0),remaining_g integer not null check(remaining_g>=0 and remaining_g<=initial_g),cost_minor bigint check(cost_minor>=0),location_id uuid references public.storage_locations(id),best_before date,created_at timestamptz not null default now()
);
create table public.operation_requests (user_id uuid not null references auth.users(id) on delete cascade,id uuid not null,operation text not null,payload jsonb not null,created_at timestamptz not null default now(),primary key(user_id,id));
create table public.inventory_movements (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,package_id uuid not null references public.inventory_packages(id),request_id uuid not null,type text not null check(type in('receive','consume','move')),delta_g integer not null,from_location_id uuid references public.storage_locations(id),to_location_id uuid references public.storage_locations(id),created_at timestamptz not null default now());
create table public.meal_logs (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,package_id uuid not null references public.inventory_packages(id),request_id uuid not null,name text not null,grams integer not null check(grams>0),cost_minor bigint check(cost_minor>=0),kcal numeric,created_at timestamptz not null default now(),unique(user_id,request_id));
create index on public.inventory_packages(user_id,best_before);
create index on public.meal_logs(user_id,created_at);
create index on public.inventory_movements(user_id,package_id,created_at);
create index on public.recipe_versions(user_id,created_at);

-- All mutation of inventory/history/version snapshots goes through authenticated RPCs.
do $$ declare t text; begin
 foreach t in array array['profiles','recipes','recipe_versions','storage_locations','cooking_batches','inventory_packages','operation_requests','inventory_movements','meal_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_read on public.%I for select to authenticated using (%s = (select auth.uid()))',t,case when t='profiles' then 'id' else 'user_id' end);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy owner_insert on public.storage_locations for insert to authenticated with check(user_id=(select auth.uid()));
grant insert on public.storage_locations to authenticated;

create function public.claim_request(p_id uuid,p_operation text,p_payload jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare inserted integer; previous public.operation_requests;
begin
 if auth.uid() is null or p_id is null then raise exception 'Authentication and request ID required'; end if;
 insert into public.operation_requests(user_id,id,operation,payload) values(auth.uid(),p_id,p_operation,p_payload) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then
 select * into previous from public.operation_requests where user_id=auth.uid() and id=p_id;
 if previous.operation<>p_operation or previous.payload<>p_payload then raise exception 'Request ID reused with different operation'; end if;
 return false;
 end if;
 return true;
end $$;
revoke all on function public.claim_request(uuid,text,jsonb) from public,anon,authenticated;

create function public.import_recipes(p_import_id uuid,p_recipes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; ingredient jsonb; step jsonb; recipe uuid;
begin
 if not public.claim_request(p_import_id,'recipes',p_recipes) then return; end if;
 if jsonb_typeof(p_recipes)<>'array' or jsonb_array_length(p_recipes) not between 1 and 50 then raise exception 'Invalid recipes'; end if;
 for item in select value from jsonb_array_elements(p_recipes) loop
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
 insert into public.recipes(user_id) values(auth.uid()) returning id into recipe;
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating)
 values(recipe,auth.uid(),1,item->>'name',(item->>'portions')::integer,item->'ingredients',item->'steps',item->>'reheating');
 end loop;
end $$;

create function public.create_batch(p_version_id uuid,p_request_id uuid,p_weight_g integer,p_package_count integer,p_cost_minor bigint,p_best_before date) returns void language plpgsql security definer set search_path='' as $$
declare recipe public.recipe_versions; batch uuid; package uuid; i integer; package_cost bigint;
begin
 if not public.claim_request(p_request_id,'batch',jsonb_build_array(p_version_id,p_weight_g,p_package_count,p_cost_minor,p_best_before)) then return; end if;
 select * into recipe from public.recipe_versions where id=p_version_id and user_id=auth.uid();
 if not found then raise exception 'Recipe not found'; end if;
 if p_weight_g is null or p_weight_g<=0 or p_weight_g>1000000 or p_package_count is null or p_package_count not between 1 and 100 or p_weight_g%p_package_count<>0 or p_cost_minor<0 or p_cost_minor>100000000 or p_best_before is null then raise exception 'Invalid batch, weight must divide equally'; end if;
 insert into public.cooking_batches(user_id,recipe_version_id,weight_g,cost_minor) values(auth.uid(),p_version_id,p_weight_g,p_cost_minor) returning id into batch;
 for i in 1..p_package_count loop
 package_cost := case when p_cost_minor is null then null else (p_cost_minor/p_package_count) + case when i<=p_cost_minor%p_package_count then 1 else 0 end end;
 insert into public.inventory_packages(user_id,batch_id,name,initial_g,remaining_g,cost_minor,best_before) values(auth.uid(),batch,recipe.name,p_weight_g/p_package_count,p_weight_g/p_package_count,package_cost,p_best_before) returning id into package;
 insert into public.inventory_movements(user_id,package_id,request_id,type,delta_g) values(auth.uid(),package,p_request_id,'receive',p_weight_g/p_package_count);
 end loop;
end $$;

create function public.consume_package(p_package_id uuid,p_request_id uuid,p_grams integer) returns void language plpgsql security definer set search_path='' as $$
declare package public.inventory_packages; cost bigint;
begin
 if not public.claim_request(p_request_id,'consume',jsonb_build_array(p_package_id,p_grams)) then return; end if;
 select * into package from public.inventory_packages where id=p_package_id and user_id=auth.uid() for update;
 if not found then raise exception 'Package not found'; end if;
 if p_grams is null or p_grams<=0 or p_grams>package.remaining_g then raise exception 'Insufficient stock'; end if;
 -- Difference of rounded cumulative allocations conserves every minor currency unit.
 cost := case when package.cost_minor is null then null else
 round(package.cost_minor::numeric*(package.initial_g-package.remaining_g+p_grams)/package.initial_g)-round(package.cost_minor::numeric*(package.initial_g-package.remaining_g)/package.initial_g) end;
 update public.inventory_packages set remaining_g=remaining_g-p_grams where id=p_package_id;
 insert into public.inventory_movements(user_id,package_id,request_id,type,delta_g) values(auth.uid(),p_package_id,p_request_id,'consume',-p_grams);
 insert into public.meal_logs(user_id,package_id,request_id,name,grams,cost_minor) values(auth.uid(),p_package_id,p_request_id,package.name,p_grams,cost);
end $$;

create function public.move_package(p_package_id uuid,p_request_id uuid,p_location_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare package public.inventory_packages;
begin
 if not public.claim_request(p_request_id,'move',jsonb_build_array(p_package_id,p_location_id)) then return; end if;
 select * into package from public.inventory_packages where id=p_package_id and user_id=auth.uid() for update;
 if not found or package.remaining_g=0 then raise exception 'Package not found or empty'; end if;
 if not exists(select 1 from public.storage_locations where id=p_location_id and user_id=auth.uid()) then raise exception 'Location not found'; end if;
 update public.inventory_packages set location_id=p_location_id where id=p_package_id;
 insert into public.inventory_movements(user_id,package_id,request_id,type,delta_g,from_location_id,to_location_id) values(auth.uid(),p_package_id,p_request_id,'move',0,package.location_id,p_location_id);
end $$;
revoke all on function public.import_recipes(uuid,jsonb), public.create_batch(uuid,uuid,integer,integer,bigint,date),public.consume_package(uuid,uuid,integer),public.move_package(uuid,uuid,uuid) from public,anon;
grant execute on function public.import_recipes(uuid,jsonb), public.create_batch(uuid,uuid,integer,integer,bigint,date),public.consume_package(uuid,uuid,integer),public.move_package(uuid,uuid,uuid) to authenticated;
