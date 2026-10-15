-- Versioned culinary roles; logical meal components and planned cooking only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.recipe_metadata(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
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
 if p ? 'meal_role' and (p->>'meal_role' not in('unknown','main','complete','side','vegetable_side','component','breakfast','snack') or jsonb_typeof(p->'meal_role')<>'string') then raise exception 'Invalid meal role';end if;
 if p ? 'allowed_slots' and (jsonb_typeof(p->'allowed_slots')<>'array' or jsonb_array_length(p->'allowed_slots')>4) then raise exception 'Invalid meal slots';end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p->'allowed_slots','[]')) s where s is null or s not in('breakfast','lunch','dinner','snack')) then raise exception 'Invalid meal slots';end if;
 if coalesce(p->>'meal_role','unknown')<>'unknown' and jsonb_array_length(coalesce(p->'allowed_slots','[]'))=0 then raise exception 'Choose allowed slots';end if;
 if p ? 'side_policy' and (jsonb_typeof(p->'side_policy') is distinct from 'string' or p->>'side_policy' not in('none','optional','required')) then raise exception 'Invalid side policy';end if;
 if p ? 'compatible_side_ids' and (jsonb_typeof(p->'compatible_side_ids')<>'array' or jsonb_array_length(p->'compatible_side_ids')>30) then raise exception 'Invalid side choices';end if;
 perform value::uuid from jsonb_array_elements_text(coalesce(p->'compatible_side_ids','[]'));
 select jsonb_object_agg(key,value) into m from jsonb_each(p) where key=any(array['category','cooking_method','prep_minutes','cooking_minutes_min','cooking_minutes_max','oven_c','meal_role','allowed_slots','side_policy','compatible_side_ids']);
 return m;
end $$;
create function public.edit_meal_plan_base_009(p_request uuid,p_changes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb; old public.meal_plan_entries; ident uuid; v uuid; begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'planner009',p_changes) then return;end if;
if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>150 then raise exception 'Invalid changes';end if;
for x in select value from jsonb_array_elements(p_changes) loop
ident:=(x->>'id')::uuid;
select * into old from public.meal_plan_entries where id=ident and user_id=auth.uid() for update;
if found then
if old.revision<>(x->>'revision')::int or x->>'revision' is null then raise exception 'REVISION_CONFLICT';end if;
else
if x->>'revision' is not null or exists(select 1 from public.meal_plan_entries where id=ident) then raise exception 'Not found';end if;
end if;
if coalesce((x->>'remove')::boolean,false) then
if old.id is null then raise exception 'Not found';end if;
delete from public.meal_plan_entries where id=ident and user_id=auth.uid();
else
v:=(x->>'recipe_version_id')::uuid;
if not exists(select 1 from public.recipe_versions where id=v and user_id=auth.uid()) then raise exception 'Invalid recipe owner';end if;
insert into public.meal_plan_entries(id,user_id,recipe_version_id,meal_date,slot,portions,revision,ready_portions,batch_portions) values(ident,auth.uid(),v,(x->>'meal_date')::date,x->>'slot',(x->>'portions')::numeric,0,coalesce((x->>'ready_portions')::numeric,0),coalesce((x->>'batch_portions')::numeric,0))
on conflict(id) do update set recipe_version_id=excluded.recipe_version_id,meal_date=excluded.meal_date,slot=excluded.slot,portions=excluded.portions,ready_portions=excluded.ready_portions,batch_portions=excluded.batch_portions,revision=public.meal_plan_entries.revision+1;
end if;
insert into public.planning_audit(user_id,entity_id,operation,before_data,after_data) values(auth.uid(),ident,'meal',to_jsonb(old),x);
end loop;end $$;
revoke all on function public.edit_meal_plan_base_009(uuid,jsonb) from public,anon,authenticated;
create table public.planned_cooking_batches(id uuid primary key,user_id uuid not null references auth.users on delete cascade,recipe_version_id uuid not null references public.recipe_versions,cooking_date date not null,portions numeric(8,2) not null check(portions>0 and portions<=100),revision integer not null default 0);
alter table public.meal_plan_entries add column planned_batch_id uuid references public.planned_cooking_batches,add column origin text not null default 'manual' check(origin in('manual','generated'));
create table public.meal_plan_components(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,entry_id uuid not null references public.meal_plan_entries on delete cascade,recipe_version_id uuid not null references public.recipe_versions,portions numeric(8,2) not null check(portions>0 and portions<=100),ready_portions numeric(8,2) not null default 0 check(ready_portions>=0 and ready_portions<=portions),planned_batch_id uuid references public.planned_cooking_batches,position integer not null,unique(entry_id,recipe_version_id));
alter table public.shopping_plans add column planner_review_required boolean not null default false;
create index on public.meal_plan_components(user_id,entry_id);
create index on public.planned_cooking_batches(user_id,cooking_date);
do $$ declare t text;begin foreach t in array array['planned_cooking_batches','meal_plan_components'] loop execute format('alter table public.%I enable row level security',t);execute format('create policy own_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create function public.classify_recipe_roles(p_request uuid,p_rows jsonb) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb;v public.recipe_versions;item jsonb;begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'recipe-roles010',p_rows) then return;end if;
if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Invalid role choices';end if;
for x in select value from jsonb_array_elements(p_rows) loop
select * into v from public.recipe_versions where id=(x->>'version_id')::uuid and user_id=auth.uid();if not found then raise exception 'Recipe not found';end if;
if exists(select 1 from jsonb_array_elements_text(coalesce(x->'compatible_side_ids','[]')) s where not exists(select 1 from public.recipes where id=s::uuid and user_id=auth.uid())) then raise exception 'Invalid side owner';end if;
item:=to_jsonb(v)||coalesce(v.metadata,'{}')||(x-'version_id');
perform public.revise_recipe(v.id,gen_random_uuid(),item);
end loop;end $$;
create function public.save_meal_schedule(p_request uuid,p_changes jsonb,p_batches jsonb,p_automatic boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb;c jsonb;b public.planned_cooking_batches;old public.meal_plan_entries;v public.recipe_versions;s public.recipe_versions;pos integer;ident uuid;batch_id uuid;related_batches uuid[];affected_plans uuid[];begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'schedule010',jsonb_build_array(p_changes,p_batches,p_automatic)) then return;end if;
if coalesce(jsonb_typeof(p_changes),'')<>'array' or jsonb_array_length(p_changes)>150 or coalesce(jsonb_typeof(p_batches),'')<>'array' or jsonb_array_length(p_batches)>150 then raise exception 'Invalid schedule';end if;
if exists(select 1 from jsonb_array_elements(p_changes) j group by j->>'id' having count(*)>1) then raise exception 'Duplicate entry ID';end if;
for x in select value from jsonb_array_elements(p_batches) loop
select * into b from public.planned_cooking_batches where id=(x->>'id')::uuid and user_id=auth.uid() for update;
if b.id is not null then if x->>'revision' is null or b.revision<>(x->>'revision')::int then raise exception 'REVISION_CONFLICT';end if;
elsif x->>'revision' is not null or exists(select 1 from public.planned_cooking_batches where id=(x->>'id')::uuid) then raise exception 'Batch not found';end if;
if not exists(select 1 from public.recipe_versions where id=(x->>'recipe_version_id')::uuid and user_id=auth.uid()) then raise exception 'Invalid batch recipe';end if;
insert into public.planned_cooking_batches(id,user_id,recipe_version_id,cooking_date,portions) values((x->>'id')::uuid,auth.uid(),(x->>'recipe_version_id')::uuid,(x->>'cooking_date')::date,(x->>'portions')::numeric) on conflict(id) do update set recipe_version_id=excluded.recipe_version_id,cooking_date=excluded.cooking_date,portions=excluded.portions,revision=public.planned_cooking_batches.revision+1;
insert into public.planning_audit(user_id,entity_id,operation,before_data,after_data) values(auth.uid(),(x->>'id')::uuid,'planned_batch',to_jsonb(b),x);
end loop;
for x in select value from jsonb_array_elements(p_changes) loop
ident:=(x->>'id')::uuid;select * into old from public.meal_plan_entries where id=ident and user_id=auth.uid() for update;
select array_agg(distinct bid) into related_batches from (select old.planned_batch_id bid union all select mc.planned_batch_id from public.meal_plan_components mc where mc.entry_id=ident and mc.user_id=auth.uid() union all select (x->>'planned_batch_id')::uuid union all select (j->>'planned_batch_id')::uuid from jsonb_array_elements(coalesce(x->'components','[]')) j) ids where bid is not null;
select array_agg(distinct spr.plan_id) into affected_plans from public.shopping_plan_recipes spr left join public.meal_plan_entries source_entry on source_entry.id=spr.meal_entry_id where spr.user_id=auth.uid() and (spr.meal_entry_id=ident or source_entry.planned_batch_id=any(related_batches) or exists(select 1 from public.meal_plan_components mc where mc.entry_id=source_entry.id and mc.planned_batch_id=any(related_batches)));

-- A bound shopping document is never silently detached or rewritten.
if coalesce((x->>'remove')::boolean,false) and coalesce(array_length(affected_plans,1),0)>0 then raise exception 'LINKED_SHOPPING: replace the meal while keeping its ID';end if;
if not coalesce((x->>'remove')::boolean,false) then
select * into v from public.recipe_versions where id=(x->>'recipe_version_id')::uuid and user_id=auth.uid();if not found then raise exception 'Recipe not found';end if;
if p_automatic and (coalesce(v.metadata->>'meal_role','unknown')='unknown' or not(coalesce(v.metadata->'allowed_slots','[]') ? (x->>'slot')) or not(case x->>'slot' when 'breakfast' then v.metadata->>'meal_role' in('breakfast','complete') when 'snack' then v.metadata->>'meal_role'='snack' else v.metadata->>'meal_role' in('main','complete') end)) then raise exception 'Recipe not eligible as a main meal';end if;
if jsonb_typeof(coalesce(x->'components','[]'))<>'array' or jsonb_array_length(coalesce(x->'components','[]'))>8 then raise exception 'Invalid components';end if;
if jsonb_array_length(coalesce(x->'components','[]'))>0 and coalesce(v.metadata->>'side_policy','none')='none' then raise exception 'SIDE_REVIEW_REQUIRED';end if;
if coalesce(v.metadata->>'side_policy','none')='required' and jsonb_array_length(coalesce(x->'components','[]'))=0 then raise exception 'Side required';end if;
if exists(select 1 from jsonb_array_elements(coalesce(x->'components','[]')) j join public.recipe_versions rv on rv.id=(j->>'recipe_version_id')::uuid group by rv.recipe_id having count(*)>1) then raise exception 'Duplicate side recipe';end if;
for c in select value from jsonb_array_elements(coalesce(x->'components','[]')) loop
select * into s from public.recipe_versions where id=(c->>'recipe_version_id')::uuid and user_id=auth.uid();
if not found or s.recipe_id=v.recipe_id or coalesce(s.metadata->>'meal_role','unknown') not in('side','vegetable_side','component') or not(coalesce(s.metadata->'allowed_slots','[]') ? (x->>'slot')) then raise exception 'Invalid side role or slot';end if;
if not(coalesce(v.metadata->'compatible_side_ids','[]') ? s.recipe_id::text) then raise exception 'Side not confirmed compatible';end if;
end loop;
end if;
perform public.edit_meal_plan_base_009(gen_random_uuid(),jsonb_build_array(x));
if not coalesce((x->>'remove')::boolean,false) then
batch_id:=(x->>'planned_batch_id')::uuid;
if batch_id is not null and not exists(select 1 from public.planned_cooking_batches where id=batch_id and user_id=auth.uid() and recipe_version_id=v.id and cooking_date<=(x->>'meal_date')::date) then raise exception 'Invalid planned batch';end if;
update public.meal_plan_entries set planned_batch_id=batch_id,origin=coalesce(x->>'origin','manual'),batch_portions=0 where id=ident;
delete from public.meal_plan_components where entry_id=ident and user_id=auth.uid();pos:=0;
for c in select value from jsonb_array_elements(coalesce(x->'components','[]')) loop
batch_id:=(c->>'planned_batch_id')::uuid;
if batch_id is not null and not exists(select 1 from public.planned_cooking_batches where id=batch_id and user_id=auth.uid() and recipe_version_id=(c->>'recipe_version_id')::uuid and cooking_date<=(x->>'meal_date')::date) then raise exception 'Invalid side batch';end if;
insert into public.meal_plan_components(user_id,entry_id,recipe_version_id,portions,ready_portions,planned_batch_id,position) values(auth.uid(),ident,(c->>'recipe_version_id')::uuid,(c->>'portions')::numeric,coalesce((c->>'ready_portions')::numeric,0),batch_id,pos);pos:=pos+1;
end loop;
end if;
update public.shopping_plans set planner_review_required=true,revision=revision+1 where user_id=auth.uid() and id=any(affected_plans);
end loop;
if exists(select 1 from (select planned_batch_id,recipe_version_id,meal_date from public.meal_plan_entries where user_id=auth.uid() union all select c.planned_batch_id,c.recipe_version_id,e.meal_date from public.meal_plan_components c join public.meal_plan_entries e on e.id=c.entry_id where c.user_id=auth.uid()) a join public.planned_cooking_batches linked_batch on linked_batch.id=a.planned_batch_id where linked_batch.user_id<>auth.uid() or linked_batch.recipe_version_id<>a.recipe_version_id or linked_batch.cooking_date>a.meal_date) then raise exception 'Invalid linked batch';end if;
-- Ready portions are evidence-based proposals, never a reservation or stock write.
if exists(
 select 1 from (
 select a.recipe_version_id,date_trunc('week',a.meal_date::timestamp) week_start,sum(a.ready_portions) used
 from (select recipe_version_id,meal_date,ready_portions from public.meal_plan_entries where user_id=auth.uid() union all select mc.recipe_version_id,e.meal_date,mc.ready_portions from public.meal_plan_components mc join public.meal_plan_entries e on e.id=mc.entry_id where mc.user_id=auth.uid()) a
 where date_trunc('week',a.meal_date::timestamp) in(select date_trunc('week',(j->>'meal_date')::date::timestamp) from jsonb_array_elements(p_changes) j)
 group by a.recipe_version_id,date_trunc('week',a.meal_date::timestamp)
 ) allocations join public.recipe_versions recipe on recipe.id=allocations.recipe_version_id
 group by recipe.recipe_id,allocations.week_start
 having sum(allocations.used)>coalesce((select sum(case when ip.portions is not null then ip.portions*ip.remaining_g/ip.initial_g else 0 end) from public.inventory_packages ip join public.cooking_batches cb on cb.id=ip.batch_id join public.recipe_versions rv on rv.id=cb.recipe_version_id where ip.user_id=auth.uid() and ip.remaining_g>0 and rv.recipe_id=recipe.recipe_id),0)
) then raise exception 'Insufficient known freezer portions';end if;
-- Allocation is a proposal only, but it must balance within its planned batch.
if exists(select 1 from public.planned_cooking_batches pb join(select planned_batch_id,sum(portions-ready_portions) used from (select planned_batch_id,portions,ready_portions from public.meal_plan_entries where user_id=auth.uid() union all select planned_batch_id,portions,ready_portions from public.meal_plan_components where user_id=auth.uid()) a where planned_batch_id is not null group by planned_batch_id) a on a.planned_batch_id=pb.id where pb.user_id=auth.uid() and a.used>pb.portions) then raise exception 'Planned batch overallocated';end if;
end $$;
revoke all on function public.classify_recipe_roles(uuid,jsonb),public.save_meal_schedule(uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.classify_recipe_roles(uuid,jsonb),public.save_meal_schedule(uuid,jsonb,jsonb,boolean) to authenticated;
-- Keep old callers working for ungrouped meals; grouped edits require the new explicit workflow.
create or replace function public.edit_meal_plan(p_request uuid,p_changes jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if exists(select 1 from jsonb_array_elements(p_changes) j join public.meal_plan_entries e on e.id=(j->>'id')::uuid where e.user_id=auth.uid() and (e.planned_batch_id is not null or exists(select 1 from public.meal_plan_components c where c.entry_id=e.id))) then raise exception 'GROUPED_MEAL_USE_PLANNER';end if;
perform public.save_meal_schedule(p_request,p_changes,'[]',false);end $$;
notify pgrst,'reload schema';
commit;
select to_regclass('public.meal_plan_components') is not null as components_ready,to_regclass('public.planned_cooking_batches') is not null as planned_batches_ready,to_regprocedure('public.classify_recipe_roles(uuid,jsonb)') is not null as roles_ready;
