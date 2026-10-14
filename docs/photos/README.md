# Fotografie receptov

Ak už SQL oznámilo úspech, ale fotografie stále hlásia chybu, použite [bezpečnú opravu 006](repair.md). Zachová receptové funkcie z rozšírenia 005; fotografickú migráciu 004 v takom prípade nespúšťajte naslepo znovu.

## Aktivácia v produkcii

Kód vyžaduje novú migráciu. Staršie migrácie sa nemenia, recepty sa znovu neimportujú.

1. Otvorte [SQL Editor svojho Supabase projektu](https://supabase.com/dashboard/project/vhjuweumaaysfklkitfi/sql/new).
2. Otvorte v GitHube súbor `supabase/migrations/202610140004_recipe_photos.sql`, kliknite **Raw**, skopírujte celý obsah do nového SQL dotazu a kliknite **Run**. Migráciu vykonajte raz. Automaticky vytvorí súkromný bucket `recipe-photos`, tabuľky, RLS a funkcie. Bucket ručne nevytvárajte ako verejný.
3. Vo Verceli otvorte projekt FREEZER OS → **Deployments** → najnovší commit → **Redeploy**, ak sa po pushi už nenasadil. Nie sú potrebné nové API kľúče ani service-role kľúč.
4. Prihláste sa na [FREEZER OS](https://freezer-os.vercel.app/recipes), otvorte recept → **Upraviť fotografie** → **Pridať fotografiu** alebo **Odfotiť jedlo**.

Pred aktiváciou migrácie zostávajú staré recepty čitateľné; fotografie zobrazia upozornenie a bežné vytvorenie receptu bez fotografie používa kompatibilnú pôvodnú operáciu.

Cloudovú migráciu tento agent nevykonal: nemá administrátorské pripojenie k databáze. Samotný verejný publishable kľúč na migráciu nestačí. Stav produkčného nasadenia nie je potvrdený.

## Používanie

Najviac 8 fotografií na recept. Vstup do 10 MB, JPG/PNG/WEBP. HEIC/HEIF sa bezpečne odmieta, pretože použitá konverzia nepodporuje spoľahlivo HEVC; exportujte JPG alebo zmeňte formát fotoaparátu na kompatibilný. Fotoaparát používa štandardný file input s `capture="environment"`; konkrétnu ponuku určuje telefón/prehlia­dač. Desktop podporuje pretiahnutie súborov.

Náhľad nového receptu je lokálny; súbory sa nahrajú až po vytvorení receptu. Pri existujúcom recepte sa správa fotografií ukladá okamžite a nezávisle od kuchárskej verzie. **Zrušiť úpravy receptu nevracia zmeny fotografií.** Prvý záber je hlavný; tlačidlá umožnia presun, výber hlavného, úpravu popisu a odstránenie. Náhrada najprv uloží nový súbor a potom transakčne vymení väzbu; pri limite 8 najprv jednu fotografiu odstráňte. Neúspešná náhrada môže nechať nový záber v galérii, pôvodný sa nestratí.

Prehliadač zmenší fotografie pred uploadom, aby sa zmestili do limitu Vercelu (multipart súbor pod 4 MB). Server znovu overí skutočný formát, najviac 24 miliónov pixelov, odmietne animované/viacstranové obrazy a vytvorí WEBP do 1600 px a náhľad do 640 × 480 px. Metadáta vrátane EXIF/GPS sa odstránia. Pôvodný plný súbor sa neuchováva. Súkromné podpísané URL platia hodinu; po vypršaní obnovte stránku. Nedostupný obraz má čitateľnú náhradu.

## Dáta a oprávnenia

`recipe_photos` patrí stabilnému ID receptu, nie `recipe_versions`. Obsahuje cesty originálneho optimalizovaného záberu a náhľadu, poradie, hlavný záber, alt, typ zdroja, URL zdroja, autora, licenciu a čas pridania. Žiadne base64. Verejný bucket ani service-role sa nepoužívajú. RLS chráni riadky i Storage cesty `userId/recipeId/photoId/`. RPC zamyká root receptu, vynucuje limit a pri úpravách porovnáva `photo_revision`, aby stará karta nevymazala novšie fotografie. Receptové verzie, suroviny, postupy a skladové transakcie sa nemenia.

Po odstránení väzby sa odstránia súbory cez Storage API. Pri zlyhaní sa zobrazí upozornenie; administrátor môže cez súkromný Storage odstrániť osirelé súbory bez väzby v `recipe_photos`. SQL priamo záznamy `storage.objects` nemaže, aby nezostali fyzické objekty neudržiavané Storage službou.

## Ilustračné fotografie a licencie

**V tomto commite sa nedováža žiadna fotografia z webu.** Prístup k stránkam Wikimedia Commons, Unsplash a Pexels skončil blokovaním sieťovou proxy (CONNECT 403). Nebolo možné overiť konkrétne fotografie, autorov ani licencie. Podľa zadania preto všetkých 15 šablón zostáva bez externého záberu, kým sa fotografia bezpečne nezíska alebo nenahrá vlastný záber. Ide o výslovne uvedený nedokončený obsahový krok, nie úspešné získanie fotografií.

Existujúce ID sa nemenia a recepty sa neduplikujú. Vlastné fotografie možno doplniť okamžite po aktivácii migrácie ku ktorémukoľvek existujúcemu receptu. Budúce licencované fotografie budú označené `source_type=external`; zobrazenie podporuje označenie „Ilustračná fotografia“, autora, licenciu a odkaz. Takýto externý import zatiaľ nemá používateľské potvrdzovacie rozhranie; nesmie sa vydávať za vlastný upload.

Voliteľné JSON `imageReferences` sú iba referencie s HTTPS URL, autorom, licenciou a alt. Import ich uloží do `recipe_image_references` so stavom `pending`, zobrazí na detaile a **nikdy automaticky nesťahuje**. Uvedený text licencie je tvrdenie importu, nie overená licencia. Import bez obrázkov zostáva kompatibilný.

```json
"imageReferences": [{
  "sourceUrl": "https://example.org/photo-page",
  "author": "Autor",
  "license": "CC BY 4.0",
  "alt": "Ilustračný záber jedla"
}]
```

## Overenie

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
Lokálny Supabase teraz zapína aj Storage: `npm run db:start`, `npm run db:migrate`, `npm run test:db`. E2E: `FREEZER_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` pri 360, 390, 768, 1280 a 1440 px. Testy používajú náhodné účty výhradne v lokálnom Supabase; obrázky sú iba testovacie fixture, nikdy produkčné fotografie.
