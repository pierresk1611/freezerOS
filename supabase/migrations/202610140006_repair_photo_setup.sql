-- Repair photo infrastructure without replacing recipe import/revision functions from 005.
-- Safe when 004 is missing, partially applied, or already active. No recipe/photo rows are deleted.
-- Photos belong to a recipe root, never to immutable cooking versions.
alter table public.recipes add column if not exists photo_revision integer not null default 0;
create table if not exists public.recipe_photos (
 id uuid primary key, recipe_id uuid not null references public.recipes(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 storage_path text not null unique, thumbnail_path text not null unique,
 position integer not null check(position between 0 and 7), is_primary boolean not null default false,
 alt text not null check(length(alt) between 1 and 300), source_type text not null check(source_type in ('own','external')),
 source_url text, author text, license text, added_at timestamptz not null default now(),
 check(source_type='own' or (source_url like 'https://%' and length(author)>0 and length(license)>0))
);
create index if not exists recipe_photos_recipe_id_position_idx on public.recipe_photos(recipe_id,position);
alter table public.recipe_photos enable row level security;
drop policy if exists photo_read on public.recipe_photos;
create policy photo_read on public.recipe_photos for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.recipes r where r.id=recipe_id and r.user_id=(select auth.uid())));
revoke all on public.recipe_photos from anon,authenticated;
grant select on public.recipe_photos to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('recipe-photos','recipe-photos',false,10485760,array['image/webp'])
 on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/webp'];
drop policy if exists recipe_photo_storage_read on storage.objects;
create policy recipe_photo_storage_read on storage.objects for select to authenticated using(bucket_id='recipe-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists recipe_photo_storage_insert on storage.objects;
create policy recipe_photo_storage_insert on storage.objects for insert to authenticated with check(bucket_id='recipe-photos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.recipes r where r.id::text=(storage.foldername(name))[2] and r.user_id=(select auth.uid()) and not r.archived));
drop policy if exists recipe_photo_storage_delete on storage.objects;
create policy recipe_photo_storage_delete on storage.objects for delete to authenticated using(bucket_id='recipe-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create or replace function public.add_recipe_photo(p_recipe uuid,p_id uuid,p_alt text) returns void language plpgsql security definer set search_path='' as $$
declare base text; n integer;
begin
 perform 1 from public.recipes where id=p_recipe and user_id=auth.uid() and not archived for update;
 if not found then raise exception 'Recipe not found'; end if;
 if exists(select 1 from public.recipe_photos where id=p_id and recipe_id=p_recipe and user_id=auth.uid()) then return; end if;
 select count(*) into n from public.recipe_photos where recipe_id=p_recipe;
 if n>=8 then raise exception 'Photo limit reached'; end if;
 base:=auth.uid()::text||'/'||p_recipe::text||'/'||p_id::text||'/';
 if not exists(select 1 from storage.objects where bucket_id='recipe-photos' and name=base||'large.webp') or not exists(select 1 from storage.objects where bucket_id='recipe-photos' and name=base||'thumb.webp') then raise exception 'Photo files missing'; end if;
 insert into public.recipe_photos(id,recipe_id,user_id,storage_path,thumbnail_path,position,is_primary,alt,source_type) values(p_id,p_recipe,auth.uid(),base||'large.webp',base||'thumb.webp',n,n=0,p_alt,'own');
 update public.recipes set photo_revision=photo_revision+1 where id=p_recipe;
end $$;
create or replace function public.save_recipe_photos(p_recipe uuid,p_revision integer,p_photos jsonb) returns void language plpgsql security definer set search_path='' as $$
declare rev integer; item jsonb; n integer:=0; ids uuid[]:=array[]::uuid[];
begin
 select photo_revision into rev from public.recipes where id=p_recipe and user_id=auth.uid() and not archived for update;
 if not found then raise exception 'Recipe not found'; end if;
 if p_revision is null or rev<>p_revision then raise exception 'Photos changed since editing'; end if;
 if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos)>8 then raise exception 'Invalid photos'; end if;
 for item in select value from jsonb_array_elements(p_photos) loop
 if (item->>'id')::uuid=any(ids) or coalesce(length(item->>'alt'),0) not between 1 and 300 then raise exception 'Invalid photo'; end if;
 update public.recipe_photos set position=n,is_primary=n=0,alt=item->>'alt' where id=(item->>'id')::uuid and recipe_id=p_recipe and user_id=auth.uid();
 if not found then raise exception 'Photo not found'; end if;
 ids:=array_append(ids,(item->>'id')::uuid); n:=n+1;
 end loop;
 delete from public.recipe_photos where recipe_id=p_recipe and user_id=auth.uid() and not(id=any(ids));
 update public.recipes set photo_revision=photo_revision+1 where id=p_recipe;
end $$;
revoke all on function public.add_recipe_photo(uuid,uuid,text),public.save_recipe_photos(uuid,integer,jsonb) from public,anon;
grant execute on function public.add_recipe_photo(uuid,uuid,text),public.save_recipe_photos(uuid,integer,jsonb) to authenticated;
-- Imported references are review-only; URLs are never fetched automatically.
create table if not exists public.recipe_image_references (
 id uuid primary key default gen_random_uuid(),recipe_id uuid not null references public.recipes(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, reference jsonb not null, status text not null default 'pending' check(status in('pending','dismissed')), added_at timestamptz not null default now()
);
alter table public.recipe_image_references enable row level security;
drop policy if exists reference_read on public.recipe_image_references;
create policy reference_read on public.recipe_image_references for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.recipe_image_references from anon,authenticated;
grant select on public.recipe_image_references to authenticated;

notify pgrst, 'reload schema';

-- The SQL Editor should show four true values after a successful repair.
select
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='recipes' and column_name='photo_revision') as photo_revision_exists,
 to_regclass('public.recipe_photos') is not null as photos_table_exists,
 to_regclass('public.recipe_image_references') is not null as references_table_exists,
 exists(select 1 from storage.buckets where id='recipe-photos' and public=false) as private_bucket_exists;
