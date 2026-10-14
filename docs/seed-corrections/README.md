# Oprava skladovania a zohrievania 15 receptových šablón

Opravený obsah je v `docs/seed-recipes.json`. Auditný súbor `storage-reheating-v1.json` obsahuje pôvodný a navrhovaný obsah každej šablóny; pôvodné nesprávne texty sú v ňom zámerne zachované len na porovnanie a ochranu pred prepísaním používateľských úprav. Ingrediencie, kroky, množstvá, porcie a vhodnosť mrazenia sa touto opravou nemenia.

## Produkčný postup bez administrátorského prepisovania dát

1. Po nasadení otvorte **Recepty → Importovať JSON → Skontrolovať skladovanie a zohrievanie**, prípadne `/recipes/corrections`.
2. Každá rozpoznaná šablóna zobrazuje aktuálne a navrhované skladovanie aj zohrievanie. Nič sa nevykonáva pri otvorení stránky.
3. Iba presná nezmenená pôvodná verzia 1 ponúka **Potvrdiť opravu ako novú verziu**. Kontrolujú sa všetky podporované editovateľné polia vrátane ingrediencií a krokov. Neprázdne doplnkové údaje tiež zablokujú automatickú opravu.
4. Používateľsky upravené recepty sú označené na individuálnu kontrolu. Návrh platí pre pôvodnú prípravu a suroviny. Pokyny prispôsobte skutočnému receptu a uložte cez samostatný editor. Táto stránka ich automaticky neprepíše.
5. Server kontrolu opakuje tesne pred uložením. Existujúce RPC `revise_recipe` overí vlastníka, uzamkne recept a odmietne zastaranú verziu pri súbežnej úprave. Opakovaná požiadavka s rovnakým ID nevytvorí ďalšiu verziu.

Nevykonáva sa UPDATE historických verzií, preimportovanie celej sady ani zmena cudzích kľúčov várok. Ceny, nutričné snapshoty, skladové balíčky a pohyby sa nemenia. Na opravu netreba novú SQL migráciu ani service-role kľúč. Produkčné zmeny vzniknú až po potvrdení prihláseným vlastníkom receptu.

Pôvodné importId ostáva zachované. Opätovné kliknutie na import počiatočnej sady pri už existujúcom importe otvorí kontrolu opráv, namiesto odoslania odlišného obsahu pod už použitým importId. Nový používateľ dostane opravené šablóny.

**Historické texty nie sú spätne vyhlásené za správne.** Staré várky zostávajú naviazané na pôvodnú verziu; ich skutočné zloženie, surový/hotový stav a história chladenia sú rozhodujúce. Pri práci so starou verziou použite vecne správne odporúčania pre konkrétnu várku. Samotná oprava textu ani ohrev neobnovia bezpečnosť jedla po nesprávnom skladovaní.

## Obsahové pravidlá

- Ryža: rýchlo schladiť ideálne do jednej hodiny, chladená najviac 24 hodín pred ohrevom, prípadne včas zmraziť. Prehriať iba raz. Ohrev nemusí odstrániť toxíny vzniknuté pri nesprávnom skladovaní.
- Hotové jedlá: menšie plytké nádoby, bezodkladné chladenie, uložiť do chladničky najneskôr do dvoch hodín (pri horúčave nad 32 °C do jednej hodiny). Chladnička najviac 5 °C; konzervatívny plán spotreby do 48 hodín alebo včasné zmrazenie.
- Hotové jedlo dôkladne prehriať v celom objeme, v pokynoch sa používa cieľ najmenej 74 °C. Čas potrebný na dosiahnutie teploty závisí od porcie a zariadenia.
- Surové obalené rezne: označiť SUROVÉ, rešpektovať dátum spotreby mäsa, oddeliť od hotových jedál. Po rozmrazení úplne tepelne spracovať; pokyn používa 75 °C počas 30 sekúnd v strede. Nie je to iba zohrievanie.
- Pyré a kaša: individuálne miešanie a tekutina z príslušného receptu. Polievka: premiešať, priviesť tekutinu do varu a prekontrolovať teplotu pevných kúskov. Žiadne pokyny na miešanie kaše v polievke ani ryža pri samostatnej cvikle.
- Studené šaláty a nakladaná cvikla: podávať studené, udržať chladenie. Neoverená kyslosť octového nálevu nie je dôkaz trvanlivosti alebo náhradou sterilizácie.

Časy predstavujú konzervatívne plánovanie pri správnej príprave a nepretržitom chladení, nie záruku bezpečnosti. Pokyny neuvádzajú univerzálnych 90 dní. Pri zmrazení približne pri −18 °C rozhoduje aj predchádzajúce zaobchádzanie; zmena konzistencie po rozmrazení sama nepotvrdzuje bezpečnosť.

Referenčné odporúčania: [FSA – chladenie](https://www.food.gov.uk/safety-hygiene/chilling), [FSA – varenie](https://www.food.gov.uk/safety-hygiene/cooking-your-food), [USDA – leftovers and food safety](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/leftovers-and-food-safety). Živé načítanie externých stránok bolo v tomto pracovnom prostredí blokované sieťovou politikou; dokument nepredstiera aktuálne online overenie.
