create or replace function public.validate_recipe(p_recipe jsonb) returns void language plpgsql set search_path='' as $$
declare item jsonb:=p_recipe; ingredient jsonb; step jsonb;
begin
 if jsonb_typeof(item->'name')<>'string' or jsonb_typeof(item->'portions')<>'number' then raise exception 'Invalid recipe types'; end if;
 if length(item->>'name') not between 2 and 160 or (item->>'portions')::integer not between 1 and 100
 or jsonb_typeof(item->'ingredients')<>'array' or jsonb_array_length(item->'ingredients') not between 1 and 100
 or jsonb_typeof(item->'steps')<>'array' or jsonb_array_length(item->'steps') not between 1 and 100
 or coalesce(length(item->>'reheating'),0) not between 1 and 2000 then raise exception 'Invalid recipe'; end if;
 for ingredient in select value from jsonb_array_elements(item->'ingredients') loop
 if jsonb_typeof(ingredient->'name')<>'string' or jsonb_typeof(ingredient->'quantity')<>'number' or (ingredient->>'quantity')::numeric>1000000 then raise exception 'Invalid ingredient types'; end if;
 if coalesce(length(ingredient->>'name'),0) not between 1 and 120 or coalesce((ingredient->>'quantity')::numeric,0)<=0 or coalesce(ingredient->>'unit','') not in('g','ml','ks') then raise exception 'Invalid ingredient'; end if;
 end loop;
 for step in select value from jsonb_array_elements(item->'steps') loop
 if jsonb_typeof(step)<>'string' or length(step#>>'{}') not between 1 and 2000 then raise exception 'Invalid step'; end if;
 end loop;

 if item ? 'meat' and coalesce(item->>'meat','') not in('none','beef','pork','chicken','other','fish') then raise exception 'Invalid meat'; end if;
 if item ? 'storage' and coalesce(length(item->>'storage'),0) not between 1 and 2000 then raise exception 'Invalid storage'; end if;
 if item ? 'freezing' and jsonb_typeof(item->'freezing')<>'boolean' then raise exception 'Invalid freezing flag'; end if;
end $$;
