-- Additive planner/shopping layer. No inventory or historical snapshot writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.meal_plan_entries add column revision integer not null default 0,add column ready_portions numeric(8,2) not null default 0 check(ready_portions>=0 and ready_portions<=portions),add column batch_portions numeric(8,2) not null default 0 check(batch_portions between 0 and 100);
create table public.planner_settings(user_id uuid primary key references auth.users on delete cascade, settings jsonb not null default '{}'::jsonb,revision integer not null default 0);
create table public.planning_audit(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,entity_id uuid not null,operation text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
create table public.pantry_items(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,name text not null check(length(name) between 1 and 120),ingredient_key text not null,quantity numeric(16,4) not null check(quantity>=0),unit text not null check(unit in('g','ml','ks')),purchased_on date,expires_on date,location text not null default '',cost_minor bigint check(cost_minor>=0),source_receipt_id uuid references public.purchase_receipts,source_receipt_item_id uuid,revision integer not null default 0);
create table public.shopping_plans(id uuid primary key,user_id uuid not null references auth.users on delete cascade,name text not null check(length(name) between 1 and 160),status text not null default 'draft' check(status in('draft','ready','exported','partially_purchased','purchased','closed','cancelled')),revision integer not null default 0,created_at timestamptz not null default now());
create table public.shopping_plan_recipes(id uuid primary key,plan_id uuid not null references public.shopping_plans on delete cascade,user_id uuid not null references auth.users on delete cascade,recipe_version_id uuid not null references public.recipe_versions,portions numeric(8,2) not null check(portions>0 and portions<=100),from_freezer numeric(8,2) not null default 0 check(from_freezer>=0 and from_freezer<=portions),meal_entry_id uuid references public.meal_plan_entries on delete set null);
create table public.shopping_plan_items(id uuid primary key,plan_id uuid not null references public.shopping_plans on delete cascade,user_id uuid not null references auth.users on delete cascade,ingredient_key text not null,name text not null check(length(name) between 1 and 160),unit text not null check(unit in('g','ml','ks')),required numeric(16,4) not null check(required>=0),quantity numeric(16,4) not null check(quantity>=0),manual boolean not null default false,checked boolean not null default false,origins jsonb not null default '[]',selection jsonb);
create table public.shopping_receipt_links(plan_id uuid not null references public.shopping_plans on delete cascade,receipt_id uuid not null references public.purchase_receipts on delete cascade,user_id uuid not null references auth.users on delete cascade,primary key(plan_id,receipt_id));
create table public.ingredient_aliases(user_id uuid not null references auth.users on delete cascade,alias text not null,canonical text not null,primary key(user_id,alias));
create table public.pantry_receipt_imports(user_id uuid not null references auth.users on delete cascade,receipt_id uuid not null references public.purchase_receipts on delete cascade,items jsonb not null,created_at timestamptz not null default now(),primary key(user_id,receipt_id));
do $$ declare t text; begin foreach t in array array['planner_settings','planning_audit','pantry_items','shopping_plans','shopping_plan_recipes','shopping_plan_items','shopping_receipt_links','ingredient_aliases','pantry_receipt_imports'] loop
execute format('alter table public.%I enable row level security',t);
execute format('create policy own_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create function public.save_planner_settings(p_request uuid,p_settings jsonb) returns void language plpgsql security definer set search_path='' as $$ declare old public.planner_settings;begin
if auth.uid() is null then raise exception 'Authentication required';end if;
if jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>10000 then raise exception 'Invalid settings';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'planner-settings009',p_settings) then return;end if;
select * into old from public.planner_settings where user_id=auth.uid() for update;
if old.user_id is not null and (p_settings->>'revision' is null or old.revision<>(p_settings->>'revision')::integer) then raise exception 'REVISION_CONFLICT';end if;
if old.user_id is null and p_settings->>'revision' is not null then raise exception 'REVISION_CONFLICT';end if;
insert into public.planner_settings(user_id,settings) values(auth.uid(),p_settings-'revision') on conflict(user_id) do update set settings=excluded.settings,revision=public.planner_settings.revision+1;
insert into public.planning_audit(user_id,entity_id,operation,after_data) values(auth.uid(),auth.uid(),'settings',p_settings);end $$;
revoke all on function public.save_planner_settings(uuid,jsonb) from public,anon;
grant execute on function public.save_planner_settings(uuid,jsonb) to authenticated;
create function public.save_ingredient_alias(p_request uuid,p_alias jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
if auth.uid() is null then raise exception 'Authentication required';end if;
if length(p_alias->>'alias') not between 1 and 160 or length(p_alias->>'canonical') not between 1 and 160 then raise exception 'Invalid alias';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'ingredient-alias009',p_alias) then return;end if;
insert into public.ingredient_aliases(user_id,alias,canonical) values(auth.uid(),p_alias->>'alias',p_alias->>'canonical') on conflict(user_id,alias) do update set canonical=excluded.canonical;
insert into public.planning_audit(user_id,entity_id,operation,after_data) values(auth.uid(),auth.uid(),'alias',p_alias);end $$;
revoke all on function public.save_ingredient_alias(uuid,jsonb) from public,anon;
grant execute on function public.save_ingredient_alias(uuid,jsonb) to authenticated;
create function public.receive_receipt_pantry(p_request uuid,p_receipt uuid,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts;i public.purchase_receipt_items;ident uuid;pantry_id uuid;cnt integer:=0;snapshot jsonb:='[]';begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not exists(select 1 from public.purchase_receipts where id=p_receipt and user_id=auth.uid() and status='confirmed') then raise exception 'Invalid confirmed receipt';end if;
if not public.claim_request(p_request,'receipt-pantry009',jsonb_build_object('receipt',p_receipt,'items',p_items)) then return jsonb_build_object('imported',0,'already',true);end if;
if exists(select 1 from public.pantry_receipt_imports where user_id=auth.uid() and receipt_id=p_receipt) then return jsonb_build_object('imported',0,'already',true);end if;
if coalesce(jsonb_typeof(p_items),'')<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Invalid items';end if;
select * into r from public.purchase_receipts where id=p_receipt and user_id=auth.uid() for update;
if r.status<>'confirmed' then raise exception 'Receipt no longer confirmed';end if;
for ident in select value::text::uuid from jsonb_array_elements_text(p_items) loop
select * into i from public.purchase_receipt_items where id=ident and receipt_id=p_receipt and user_id=auth.uid();
if not found or i.ingredient_name is null or length(trim(i.ingredient_name))=0 or i.quantity is null or i.quantity<=0 or i.unit not in('g','kg','ml','l','ks') or i.total_minor<0 or not exists(select 1 from public.purchase_categories where id=i.category and kind='food') then raise exception 'Item needs ingredient mapping and known quantity';end if;
if snapshot @> jsonb_build_array(jsonb_build_object('id',ident)) then raise exception 'Duplicate item selection';end if;
insert into public.pantry_items(user_id,name,ingredient_key,quantity,unit,purchased_on,cost_minor,source_receipt_id,source_receipt_item_id) values(auth.uid(),i.ingredient_name,trim(regexp_replace(public.recipe_import_text(i.ingredient_name),'[^a-z0-9]+',' ','g')),i.quantity*case when i.unit in('kg','l') then 1000 else 1 end,case i.unit when 'kg' then 'g' when 'l' then 'ml' else i.unit end,r.receipt_date,i.total_minor,p_receipt,i.id) returning id into pantry_id;
snapshot:=snapshot||jsonb_build_array(to_jsonb(i)||jsonb_build_object('pantry_id',pantry_id));cnt:=cnt+1;
end loop;
insert into public.pantry_receipt_imports values(auth.uid(),p_receipt,snapshot,now());
insert into public.planning_audit(user_id,entity_id,operation,after_data) values(auth.uid(),p_receipt,'receipt_pantry',snapshot);
return jsonb_build_object('imported',cnt,'already',false);end $$;
revoke all on function public.receive_receipt_pantry(uuid,uuid,jsonb) from public,anon;
grant execute on function public.receive_receipt_pantry(uuid,uuid,jsonb) to authenticated;
-- All changed entries keep their logical ID and immutable version reference.
create function public.edit_meal_plan(p_request uuid,p_changes jsonb) returns void language plpgsql security definer set search_path='' as $$
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
create function public.save_pantry_item(p_request uuid,p_item jsonb) returns void language plpgsql security definer set search_path='' as $$
declare old public.pantry_items; ident uuid:=(p_item->>'id')::uuid;begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'pantry009',p_item) then return;end if;
select * into old from public.pantry_items where id=ident and user_id=auth.uid() for update;
if old.id is not null then
if old.revision<>(p_item->>'revision')::int or p_item->>'revision' is null then raise exception 'REVISION_CONFLICT';end if;
elsif p_item->>'revision' is not null or exists(select 1 from public.pantry_items where id=ident) then raise exception 'Not found';end if;
insert into public.pantry_items(id,user_id,name,ingredient_key,quantity,unit,purchased_on,expires_on,location,cost_minor) values(ident,auth.uid(),p_item->>'name',p_item->>'ingredient_key',(p_item->>'quantity')::numeric,p_item->>'unit',(p_item->>'purchased_on')::date,(p_item->>'expires_on')::date,coalesce(p_item->>'location',''),(p_item->>'cost_minor')::bigint)
on conflict(id) do update set name=excluded.name,ingredient_key=excluded.ingredient_key,quantity=excluded.quantity,unit=excluded.unit,purchased_on=excluded.purchased_on,expires_on=excluded.expires_on,location=excluded.location,cost_minor=excluded.cost_minor,revision=public.pantry_items.revision+1;
insert into public.planning_audit(user_id,entity_id,operation,before_data,after_data) values(auth.uid(),ident,'pantry',to_jsonb(old),p_item);end $$;
create function public.save_shopping_plan(p_request uuid,p_plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare old public.shopping_plans; ident uuid:=(p_plan->>'id')::uuid;x jsonb;v uuid;begin
if auth.uid() is null then raise exception 'Authentication required';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9009));
if not public.claim_request(p_request,'shopping009',p_plan) then return;end if;
select * into old from public.shopping_plans where id=ident and user_id=auth.uid() for update;
if old.id is not null then
if old.revision<>(p_plan->>'revision')::int or p_plan->>'revision' is null then raise exception 'REVISION_CONFLICT';end if;
if old.status not in('draft','ready') and (p_plan->'recipes' is distinct from (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'recipe_version_id',r.recipe_version_id,'portions',r.portions,'from_freezer',r.from_freezer,'meal_entry_id',r.meal_entry_id) order by r.id),'[]') from public.shopping_plan_recipes r where plan_id=ident)) then raise exception 'LOCKED_PLAN_CREATE_SUPPLEMENT';end if;
else
if p_plan->>'revision' is not null or exists(select 1 from public.shopping_plans where id=ident) then raise exception 'Not found';end if;
end if;
if jsonb_array_length(p_plan->'recipes')>100 or jsonb_array_length(p_plan->'items')>500 then raise exception 'Too many items';end if;
-- Exported/purchased lists are immutable, except explicit status and receipt linking.
if old.id is not null and old.status not in('draft','ready') then
if (select coalesce(jsonb_agg(j-'checked' order by j->>'id'),'[]') from jsonb_array_elements(p_plan->'items') j) is distinct from (select coalesce(jsonb_agg(to_jsonb(i)-'plan_id'-'user_id'-'checked' order by i.id),'[]') from public.shopping_plan_items i where i.plan_id=ident) then raise exception 'LOCKED_PLAN_CREATE_SUPPLEMENT';end if;
if old.status in('closed','cancelled') and exists(select 1 from jsonb_array_elements(p_plan->'items') j join public.shopping_plan_items i on i.id=(j->>'id')::uuid where i.plan_id=ident and i.checked is distinct from (j->>'checked')::boolean) then raise exception 'Closed plan';end if;
for x in select value from jsonb_array_elements(p_plan->'items') loop update public.shopping_plan_items set checked=(x->>'checked')::boolean where id=(x->>'id')::uuid and plan_id=ident;end loop;
if (p_plan->>'status') not in('partially_purchased','purchased','closed','cancelled',old.status) then raise exception 'Invalid transition';end if;
update public.shopping_plans set status=p_plan->>'status',revision=revision+1 where id=ident;
else
insert into public.shopping_plans(id,user_id,name,status) values(ident,auth.uid(),p_plan->>'name',p_plan->>'status') on conflict(id) do update set name=excluded.name,status=excluded.status,revision=public.shopping_plans.revision+1;
delete from public.shopping_plan_recipes where plan_id=ident;
for x in select value from jsonb_array_elements(p_plan->'recipes') loop
v:=(x->>'recipe_version_id')::uuid;
if not exists(select 1 from public.recipe_versions where id=v and user_id=auth.uid()) then raise exception 'Invalid recipe owner';end if;
if x->>'meal_entry_id' is not null and not exists(select 1 from public.meal_plan_entries where id=(x->>'meal_entry_id')::uuid and user_id=auth.uid()) then raise exception 'Invalid meal owner';end if;
insert into public.shopping_plan_recipes(id,plan_id,user_id,recipe_version_id,portions,from_freezer,meal_entry_id) values((x->>'id')::uuid,ident,auth.uid(),v,(x->>'portions')::numeric,coalesce((x->>'from_freezer')::numeric,0),(x->>'meal_entry_id')::uuid);
end loop;
-- Known portions only; reject over-allocation even when called without the UI.
if exists(
 select 1 from public.shopping_plan_recipes c join public.recipe_versions v on v.id=c.recipe_version_id
 where c.plan_id=ident group by v.recipe_id having sum(c.from_freezer)>coalesce((
 select sum(case when p.portions is not null then p.portions*p.remaining_g/p.initial_g else 0 end)
 from public.inventory_packages p join public.cooking_batches b on b.id=p.batch_id join public.recipe_versions rv on rv.id=b.recipe_version_id
 where p.user_id=auth.uid() and p.remaining_g>0 and rv.recipe_id=v.recipe_id),0)
) then raise exception 'Insufficient known freezer portions';end if;
delete from public.shopping_plan_items where plan_id=ident;
for x in select value from jsonb_array_elements(p_plan->'items') loop
insert into public.shopping_plan_items(id,plan_id,user_id,ingredient_key,name,unit,required,quantity,manual,checked,origins,selection) values((x->>'id')::uuid,ident,auth.uid(),x->>'ingredient_key',x->>'name',x->>'unit',(x->>'required')::numeric,(x->>'quantity')::numeric,coalesce((x->>'manual')::boolean,false),coalesce((x->>'checked')::boolean,false),coalesce(x->'origins','[]'),x->'selection');
end loop;
end if;
if jsonb_array_length(coalesce(p_plan->'calendar_changes','[]'))>0 then
if old.id is not null and old.status not in('draft','ready') then raise exception 'LOCKED_PLAN_CREATE_SUPPLEMENT';end if;
for x in select value from jsonb_array_elements(p_plan->'calendar_changes') loop
if not exists(select 1 from public.shopping_plan_recipes where plan_id=ident and meal_entry_id=(x->>'id')::uuid and recipe_version_id=(x->>'recipe_version_id')::uuid) then raise exception 'Invalid calendar synchronization';end if;
end loop;
perform public.edit_meal_plan(gen_random_uuid(),p_plan->'calendar_changes');
end if;
if p_plan->>'receipt_id' is not null then
if not exists(select 1 from public.purchase_receipts where id=(p_plan->>'receipt_id')::uuid and user_id=auth.uid() and status='confirmed') then raise exception 'Invalid confirmed receipt';end if;
insert into public.shopping_receipt_links values(ident,(p_plan->>'receipt_id')::uuid,auth.uid()) on conflict do nothing;
end if;
insert into public.planning_audit(user_id,entity_id,operation,before_data,after_data) values(auth.uid(),ident,'shopping',to_jsonb(old),p_plan);end $$;
-- Keep original category kinds compatible; these new categories are non-food.
insert into public.purchase_categories(id,label,kind) values('alcohol','Alkohol','equipment'),('drugstore','Drogéria','equipment');
revoke all on function public.edit_meal_plan(uuid,jsonb),public.save_pantry_item(uuid,jsonb),public.save_shopping_plan(uuid,jsonb) from public,anon;
grant execute on function public.edit_meal_plan(uuid,jsonb),public.save_pantry_item(uuid,jsonb),public.save_shopping_plan(uuid,jsonb) to authenticated;
-- Refuse to overwrite an independently customized production purchase RPC.
do $$ begin
if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.save_purchase(uuid,uuid,integer,jsonb,boolean)'::regprocedure) is distinct from 'e453e9911d3edb216d9be68303a188ee' then raise exception 'PURCHASE_RPC_CHANGED: review existing save_purchase before migration 009';end if;
end $$;
-- Preserve purchase RPC signature and all accounting logic; extend category validation to catalog.
create or replace function public.save_purchase(p_receipt uuid,p_request uuid,p_revision integer,p_data jsonb,p_duplicate_confirmed boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts; item jsonb; merchant uuid; product uuid; position integer:=0; sum_minor bigint:=0; old jsonb; normalized text; cat text;
begin
if not public.claim_request(p_request,'purchase',jsonb_build_array(p_receipt,p_revision,p_data,p_duplicate_confirmed)) then return;end if;
-- Serialize per owner, including two separately created drafts for the same order.
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7007));
select * into r from public.purchase_receipts where id=p_receipt and user_id=auth.uid() for update;
if not found or r.revision is distinct from p_revision or r.status='cancelled' then raise exception 'STALE_PURCHASE';end if;
if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 200 or coalesce(length(btrim(p_data->>'merchant')),0) not between 1 and 160 or p_data->>'currency' is distinct from 'CZK' or length(coalesce(p_data->>'order_number',''))>120 or p_data->>'date' is null or p_data->>'total_minor' is null then raise exception 'Incomplete purchase';end if;
if abs((p_data->>'total_minor')::bigint)>10000000000 then raise exception 'Invalid amount';end if;
select id into merchant from public.purchase_merchants where user_id=auth.uid() and lower(btrim(name))=lower(btrim(p_data->>'merchant')) limit 1;
if merchant is null then insert into public.purchase_merchants(user_id,name) values(auth.uid(),btrim(p_data->>'merchant')) returning id into merchant;end if;
if p_duplicate_confirmed is distinct from true and exists(select 1 from public.purchase_receipts x where x.user_id=auth.uid() and x.id<>r.id and x.status='confirmed' and (
(x.merchant_id=merchant and nullif(p_data->>'order_number','') is not null and x.order_number=p_data->>'order_number') or
(x.merchant_id=merchant and x.receipt_date=(p_data->>'date')::date and x.total_minor=(p_data->>'total_minor')::bigint) or
(x.merchant_id=merchant and (select jsonb_agg(jsonb_build_array(lower(btrim(i.name)),i.quantity,i.unit,i.total_minor) order by lower(btrim(i.name)),i.quantity,i.unit,i.total_minor) from public.purchase_receipt_items i where i.receipt_id=x.id)=(select jsonb_agg(jsonb_build_array(lower(btrim(j->>'name')),(j->>'quantity')::numeric,j->>'unit',(j->>'total_minor')::bigint) order by lower(btrim(j->>'name')),(j->>'quantity')::numeric,j->>'unit',(j->>'total_minor')::bigint) from jsonb_array_elements(p_data->'items') j)) or
exists(select 1 from public.purchase_receipt_files a join public.purchase_receipt_files b on a.sha256=b.sha256 where a.receipt_id=r.id and b.receipt_id=x.id))) then raise exception 'POSSIBLE_DUPLICATE';end if;
select jsonb_build_object('receipt',to_jsonb(r),'items',coalesce(jsonb_agg(to_jsonb(i)),'[]')) into old from public.purchase_receipt_items i where i.receipt_id=r.id;
delete from public.purchase_receipt_items where receipt_id=r.id;
for item in select value from jsonb_array_elements(p_data->'items') loop
cat:=item->>'category';
if length(coalesce(item->>'product_name',''))>200 or length(coalesce(item->>'ingredient_name',''))>120 or abs(coalesce((item->>'unit_price_minor')::bigint,0))>10000000000 or (item->>'discount_minor')::bigint>10000000000 or coalesce(length(btrim(item->>'name')),0) not between 1 and 200 or cat is null or not exists(select 1 from public.purchase_categories catalog where catalog.id=cat) or item->>'total_minor' is null or abs((item->>'total_minor')::bigint)>10000000000 or (item->>'discount_minor')::bigint<0 or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>1000000 or (item->>'unit') not in('g','kg','ml','l','ks','balenie') or (item->>'confidence')::numeric not between 0 and 1 then raise exception 'Invalid purchase item';end if;
sum_minor:=sum_minor+(item->>'total_minor')::bigint;
normalized:=lower(btrim(item->>'name'));
insert into public.purchase_products(user_id,name,category,ingredient_name) values(auth.uid(),lower(btrim(coalesce(nullif(item->>'product_name',''),item->>'name'))),cat,nullif(btrim(item->>'ingredient_name'),'')) on conflict(user_id,name) do update set category=excluded.category,ingredient_name=excluded.ingredient_name returning id into product;
insert into public.purchase_product_aliases(user_id,alias,product_id) values(auth.uid(),normalized,product) on conflict(user_id,alias) do update set product_id=excluded.product_id;
insert into public.purchase_receipt_items(user_id,receipt_id,product_id,product_name,ingredient_name,name,category,quantity,unit,unit_price_minor,discount_minor,total_minor,confidence,position) values(auth.uid(),r.id,product,coalesce(nullif(btrim(item->>'product_name'),''),btrim(item->>'name')),nullif(btrim(item->>'ingredient_name'),''),item->>'name',cat,(item->>'quantity')::numeric,item->>'unit',(item->>'unit_price_minor')::bigint,(item->>'discount_minor')::bigint,(item->>'total_minor')::bigint,(item->>'confidence')::numeric,position);position:=position+1;
end loop;
if sum_minor<>(p_data->>'total_minor')::bigint then raise exception 'TOTAL_MISMATCH';end if;
update public.purchase_receipts set merchant_id=merchant,receipt_date=(p_data->>'date')::date,order_number=nullif(p_data->>'order_number',''),total_minor=sum_minor,status='confirmed',draft_data=null,revision=revision+1 where id=r.id;
insert into public.purchase_audit(user_id,receipt_id,operation,before_data,after_data) values(auth.uid(),r.id,case when r.status='draft' then 'confirm' else 'correct' end,old,p_data);
end $$;
notify pgrst,'reload schema';
commit;
select to_regclass('public.shopping_plans') is not null as shopping_ready,to_regclass('public.pantry_items') is not null as pantry_ready,to_regprocedure('public.edit_meal_plan(uuid,jsonb)') is not null as planner_ready;
