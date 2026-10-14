-- Additive purchase ledger; existing cooking/inventory snapshots are untouched.
create table public.purchase_categories(id text primary key,label text not null,kind text not null check(kind in('food','equipment','fees')));
insert into public.purchase_categories(id,label,kind) values
('beef','Hovädzie','food'),('pork','Bravčové','food'),('chicken','Kuracie','food'),('meat','Ostatné mäso','food'),('vegetables','Zelenina','food'),('fruit','Ovocie','food'),('legumes','Kukurica a strukoviny','food'),('grains','Ryža a obilniny','food'),('potatoes','Zemiaky','food'),('pasta','Cestoviny','food'),('dairy','Mliečne výrobky','food'),('eggs','Vajcia','food'),('oil','Oleje','food'),('sauces','Omáčky','food'),('spices','Koreniny','food'),('food','Ostatné potraviny','food'),('equipment','Nepotravinový tovar','equipment'),('fees','Doprava a poplatky','fees');
alter table public.purchase_categories enable row level security;
create policy category_catalog on public.purchase_categories for select to authenticated using(true);
revoke all on public.purchase_categories from anon,authenticated;
grant select on public.purchase_categories to authenticated;
create table public.purchase_merchants(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,name text not null,unique(user_id,name));
create table public.purchase_receipts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,merchant_id uuid references public.purchase_merchants,receipt_date date,order_number text,currency text not null default 'CZK' check(currency='CZK'),total_minor bigint,draft_data jsonb,status text not null default 'draft' check(status in('draft','confirmed','cancelled')),revision integer not null default 0,created_at timestamptz not null default now());
create table public.purchase_receipt_files(id uuid primary key,user_id uuid not null references auth.users on delete cascade,receipt_id uuid not null references public.purchase_receipts on delete cascade,path text not null unique,sha256 text not null check(length(sha256)=64),mime text not null,filename text not null,created_at timestamptz not null default now(),unique(receipt_id,sha256));
create table public.purchase_products(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,name text not null,category text not null references public.purchase_categories(id),ingredient_name text,unique(user_id,name));
create table public.purchase_product_aliases(user_id uuid not null references auth.users on delete cascade,alias text not null,product_id uuid not null references public.purchase_products on delete cascade,primary key(user_id,alias));
create table public.purchase_receipt_items(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,receipt_id uuid not null references public.purchase_receipts on delete cascade,product_id uuid references public.purchase_products,product_name text,ingredient_name text,name text not null,category text not null references public.purchase_categories(id),quantity numeric(14,4),unit text,unit_price_minor bigint,discount_minor bigint,total_minor bigint not null,confidence numeric(4,3),position integer not null);
create table public.purchase_import_jobs(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,receipt_id uuid not null references public.purchase_receipts on delete cascade,provider text not null,status text not null check(status in('running','succeeded','failed')),result jsonb,created_at timestamptz not null default now());
create table public.purchase_audit(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,receipt_id uuid not null references public.purchase_receipts on delete cascade,operation text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
create table public.purchase_budgets(user_id uuid not null references auth.users on delete cascade,month date not null check(extract(day from month)=1),amount_minor bigint not null check(amount_minor>=0 and amount_minor<=10000000000),primary key(user_id,month));
create index on public.purchase_receipts(user_id,receipt_date,status);
create index on public.purchase_receipt_files(user_id,sha256);
do $$ declare t text; begin foreach t in array array['purchase_merchants','purchase_receipts','purchase_receipt_files','purchase_products','purchase_product_aliases','purchase_receipt_items','purchase_import_jobs','purchase_audit','purchase_budgets'] loop
execute format('alter table public.%I enable row level security',t);
execute format('create policy own_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
execute format('revoke all on public.%I from anon,authenticated',t);
execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy own_budget on public.purchase_budgets for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant insert,update,delete on public.purchase_budgets to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('purchase-receipts','purchase-receipts',false,4000000,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy receipt_read on storage.objects for select to authenticated using(bucket_id='purchase-receipts' and (storage.foldername(name))[1]=auth.uid()::text);
create policy receipt_upload on storage.objects for insert to authenticated with check(bucket_id='purchase-receipts' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.purchase_receipts r where r.id::text=(storage.foldername(name))[2] and r.user_id=auth.uid() and r.status='draft'));
create policy receipt_cleanup on storage.objects for delete to authenticated using(bucket_id='purchase-receipts' and (storage.foldername(name))[1]=auth.uid()::text and (not exists(select 1 from public.purchase_receipt_files f where f.path=name) or exists(select 1 from public.purchase_receipts r where r.id::text=(storage.foldername(name))[2] and r.user_id=auth.uid() and r.status='draft')));
create function public.create_purchase_draft(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
if auth.uid() is null then raise exception 'Authentication required';end if;
insert into public.purchase_receipts(id,user_id) values(p_id,auth.uid()) on conflict do nothing;
if not exists(select 1 from public.purchase_receipts where id=p_id and user_id=auth.uid()) then raise exception 'Not found';end if;end $$;
create function public.attach_purchase_file(p_id uuid,p_receipt uuid,p_hash text,p_mime text,p_filename text,p_path text) returns void language plpgsql security definer set search_path='' as $$ begin
perform 1 from public.purchase_receipts where id=p_receipt and user_id=auth.uid() and status='draft' for update;if not found then raise exception 'Not a draft';end if;
if (select count(*) from public.purchase_receipt_files where receipt_id=p_receipt)>=8 then raise exception 'Too many documents';end if;
if p_path<>auth.uid()::text||'/'||p_receipt::text||'/'||p_id::text or p_mime not in('image/jpeg','image/png','image/webp','application/pdf') or length(p_filename) not between 1 and 200 or not exists(select 1 from storage.objects where bucket_id='purchase-receipts' and name=p_path) then raise exception 'Invalid document';end if;
insert into public.purchase_receipt_files(id,user_id,receipt_id,path,sha256,mime,filename) values(p_id,auth.uid(),p_receipt,p_path,p_hash,p_mime,p_filename);end $$;
create function public.begin_purchase_import(p_receipt uuid) returns uuid language plpgsql security definer set search_path='' as $$ declare job uuid;begin
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7008));
if not exists(select 1 from public.purchase_receipts where id=p_receipt and user_id=auth.uid() and status='draft') then raise exception 'Invalid import';end if;
if exists(select 1 from public.purchase_import_jobs where user_id=auth.uid() and status='running' and created_at>now()-interval '2 minutes') or (select count(*) from public.purchase_import_jobs where user_id=auth.uid() and created_at>now()-interval '10 minutes')>=5 then raise exception 'Too many recognition requests';end if;
insert into public.purchase_import_jobs(user_id,receipt_id,provider,status) values(auth.uid(),p_receipt,'openai','running') returning id into job;return job;end $$;
create function public.record_purchase_import(p_job uuid,p_status text,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
if p_status not in('succeeded','failed') then raise exception 'Invalid import';end if;
update public.purchase_import_jobs set status=p_status,result=p_result where id=p_job and user_id=auth.uid() and status='running';if not found then raise exception 'Invalid job';end if;end $$;
create function public.save_purchase_draft(p_receipt uuid,p_revision integer,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
if octet_length(p_data::text)>200000 then raise exception 'Draft too large';end if;
update public.purchase_receipts set draft_data=p_data,revision=revision+1 where id=p_receipt and user_id=auth.uid() and status='draft' and revision=p_revision;
if not found then raise exception 'STALE_PURCHASE';end if;
insert into public.purchase_audit(user_id,receipt_id,operation,after_data) values(auth.uid(),p_receipt,'draft',p_data);end $$;
create function public.save_purchase(p_receipt uuid,p_request uuid,p_revision integer,p_data jsonb,p_duplicate_confirmed boolean default false) returns void language plpgsql security definer set search_path='' as $$
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
if length(coalesce(item->>'product_name',''))>200 or length(coalesce(item->>'ingredient_name',''))>120 or abs(coalesce((item->>'unit_price_minor')::bigint,0))>10000000000 or (item->>'discount_minor')::bigint>10000000000 or coalesce(length(btrim(item->>'name')),0) not between 1 and 200 or cat is null or cat not in('beef','pork','chicken','meat','vegetables','fruit','legumes','grains','potatoes','pasta','dairy','eggs','oil','sauces','spices','food','equipment','fees') or item->>'total_minor' is null or abs((item->>'total_minor')::bigint)>10000000000 or (item->>'discount_minor')::bigint<0 or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>1000000 or (item->>'unit') not in('g','kg','ml','l','ks','balenie') or (item->>'confidence')::numeric not between 0 and 1 then raise exception 'Invalid purchase item';end if;
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
create function public.cancel_purchase(p_receipt uuid,p_request uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$ declare r public.purchase_receipts;begin
if not public.claim_request(p_request,'cancel_purchase',jsonb_build_array(p_receipt,p_revision)) then return;end if;
select * into r from public.purchase_receipts where id=p_receipt and user_id=auth.uid() for update;
if not found or r.revision is distinct from p_revision then raise exception 'STALE_PURCHASE';end if;
update public.purchase_receipts set status='cancelled',revision=revision+1 where id=r.id;
insert into public.purchase_audit(user_id,receipt_id,operation,before_data) values(auth.uid(),r.id,'cancel',to_jsonb(r));end $$;
create view public.purchase_price_history with(security_invoker=true) as select i.*,r.receipt_date,r.merchant_id,case when i.quantity>0 and i.unit is not null then i.total_minor::numeric/(i.quantity*case when i.unit in('g','ml') then .001 else 1 end) end as normalized_price_minor,case i.unit when 'g' then 'kg' when 'ml' then 'l' else i.unit end as normalized_unit from public.purchase_receipt_items i join public.purchase_receipts r on r.id=i.receipt_id where r.status='confirmed';
grant select on public.purchase_price_history to authenticated;
revoke all on function public.create_purchase_draft(uuid),public.attach_purchase_file(uuid,uuid,text,text,text,text),public.record_purchase_import(uuid,text,jsonb),public.begin_purchase_import(uuid),public.save_purchase_draft(uuid,integer,jsonb),public.save_purchase(uuid,uuid,integer,jsonb,boolean),public.cancel_purchase(uuid,uuid,integer) from public,anon;
grant execute on function public.create_purchase_draft(uuid),public.attach_purchase_file(uuid,uuid,text,text,text,text),public.record_purchase_import(uuid,text,jsonb),public.begin_purchase_import(uuid),public.save_purchase_draft(uuid,integer,jsonb),public.save_purchase(uuid,uuid,integer,jsonb,boolean),public.cancel_purchase(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
-- SQL Editor returns explicit readiness instead of only "No rows returned".
select to_regclass('public.purchase_receipts') is not null as receipts_ready,
       to_regclass('public.purchase_price_history') is not null as prices_ready,
       exists(select 1 from storage.buckets where id='purchase-receipts' and public=false) as private_bucket_ready,
       (select count(*)=18 from public.purchase_categories) as categories_ready;
