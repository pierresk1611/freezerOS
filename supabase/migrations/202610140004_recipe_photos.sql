-- Photos belong to a recipe root, never to immutable cooking versions.
alter table public.recipes add column photo_revision integer not null default 0;
create table public.recipe_photos (
 id uuid primary key, recipe_id uuid not null references public.recipes(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 storage_path text not null unique, thumbnail_path text not null unique,
 position integer not null check(position between 0 and 7), is_primary boolean not null default false,
 alt text not null check(length(alt) between 1 and 300), source_type text not null check(source_type in ('own','external')),
 source_url text, author text, license text, added_at timestamptz not null default now(),
 check(source_type='own' or (source_url like 'https://%' and length(author)>0 and length(license)>0))
);
create index on public.recipe_photos(recipe_id,position);
alter table public.recipe_photos enable row level security;
create policy photo_read on public.recipe_photos for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.recipes r where r.id=recipe_id and r.user_id=(select auth.uid())));
revoke all on public.recipe_photos from anon,authenticated;
grant select on public.recipe_photos to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('recipe-photos','recipe-photos',false,10485760,array['image/webp'])
 on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/webp'];
create policy recipe_photo_storage_read on storage.objects for select to authenticated using(bucket_id='recipe-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy recipe_photo_storage_insert on storage.objects for insert to authenticated with check(bucket_id='recipe-photos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.recipes r where r.id::text=(storage.foldername(name))[2] and r.user_id=(select auth.uid()) and not r.archived));
create policy recipe_photo_storage_delete on storage.objects for delete to authenticated using(bucket_id='recipe-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create function public.add_recipe_photo(p_recipe uuid,p_id uuid,p_alt text) returns void language plpgsql security definer set search_path='' as $$
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
create function public.save_recipe_photos(p_recipe uuid,p_revision integer,p_photos jsonb) returns void language plpgsql security definer set search_path='' as $$
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
-- Creating through the editor returns a stable root for subsequent photo uploads.
create function public.create_recipe_with_id(p_id uuid,p_recipe jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.claim_request(p_id,'create_recipe',p_recipe) then return; end if;
 perform public.validate_recipe(p_recipe);
 insert into public.recipes(id,user_id) values(p_id,auth.uid());
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing)
 values(p_id,auth.uid(),1,p_recipe->>'name',(p_recipe->>'portions')::integer,p_recipe->'ingredients',p_recipe->'steps',p_recipe->>'reheating',coalesce(p_recipe->>'meat','none'),coalesce(p_recipe->>'storage','Rýchlo schlaďte.'),coalesce((p_recipe->>'freezing')::boolean,true));
end $$;
revoke all on function public.create_recipe_with_id(uuid,jsonb) from public,anon;
grant execute on function public.create_recipe_with_id(uuid,jsonb) to authenticated;

-- Imported references are review-only; URLs are never fetched automatically.
create table public.recipe_image_references (
 id uuid primary key default gen_random_uuid(),recipe_id uuid not null references public.recipes(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, reference jsonb not null, status text not null default 'pending' check(status in('pending','dismissed')), added_at timestamptz not null default now()
);
alter table public.recipe_image_references enable row level security;
create policy reference_read on public.recipe_image_references for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.recipe_image_references from anon,authenticated;
grant select on public.recipe_image_references to authenticated;
create or replace function public.import_recipes(p_import_id uuid,p_recipes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; ingredient jsonb; step jsonb; recipe uuid; reference jsonb;
begin
 if not public.claim_request(p_import_id,'recipes',p_recipes) then return; end if;
 if jsonb_typeof(p_recipes)<>'array' or jsonb_array_length(p_recipes) not between 1 and 50 then raise exception 'Invalid recipes'; end if;
 for item in select value from jsonb_array_elements(p_recipes) loop
 perform public.validate_recipe(item);
 insert into public.recipes(user_id) values(auth.uid()) returning id into recipe;
 insert into public.recipe_versions(recipe_id,user_id,version,name,portions,ingredients,steps,reheating,meat,storage,freezing)
 values(recipe,auth.uid(),1,item->>'name',(item->>'portions')::integer,item->'ingredients',item->'steps',item->>'reheating',coalesce(item->>'meat','none'),coalesce(item->>'storage','Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.'),coalesce((item->>'freezing')::boolean,true));
 if item ? 'imageReferences' then
 if jsonb_typeof(item->'imageReferences') is distinct from 'array' or jsonb_array_length(item->'imageReferences')>8 then raise exception 'Invalid image references'; end if;
 for reference in select value from jsonb_array_elements(item->'imageReferences') loop
 if coalesce(reference->>'sourceUrl','') not like 'https://%' or coalesce(length(reference->>'alt'),0) not between 1 and 300 or coalesce(length(reference->>'author'),0) not between 1 and 200 or coalesce(length(reference->>'license'),0) not between 1 and 300 then raise exception 'Invalid image reference'; end if;
 insert into public.recipe_image_references(recipe_id,user_id,reference) values(recipe,auth.uid(),reference);
 end loop;
 end if;
 end loop;
end $$;
