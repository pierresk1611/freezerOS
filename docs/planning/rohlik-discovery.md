# Rohlík MCP – stav overenia (15. 10. 2026)

Oficiálne odkazy: https://www.rohlik.cz/en-CZ/mcp-docs,
https://www.rohlik.cz/stranka/mcp-server, endpoint https://mcp.rohlik.cz/mcp (bez koncového lomítka).

Používateľ poskytol text oficiálnej stránky: OAuth, vyhľadávanie produktov, správa košíka, recepty, objednávky a nákupné zoznamy sú dokumentované. Podmienky uvádzajú bežné osobné používanie e-shopu a konečné potvrdenie objednávky na Rohlíku. Iné používanie vyžaduje predchádzajúci písomný súhlas. Text nesľubuje automatické právo registrácie vlastného klienta.

## Výsledok discovery z tohto prostredia

GET oboch oficiálnych stránok, GET `https://mcp.rohlik.cz/.well-known/oauth-authorization-server` a POST MCP `initialize` na presný endpoint skončili na sieťovom proxy: `CONNECT tunnel failed, response 403`. Nejde o dôkaz odmietnutia klienta samotným Rohlíkom; odpoveď pochádza ešte pred spojeniami so službou. Autorizáciu nebolo možné začať.

| Možnosť | Dokumentované | Overené v FREEZER OS |
|---|---|---|
| OAuth | Áno, podporované asistenty | Nie |
| Registrácia vlastného klienta, redirect URI | Text neuvádza podrobnosti | Nie |
| PKCE, refresh, revokácia | Neoverené | Nie |
| HTTP transport / protocol version | HTTP v dodanom návode Claude Code; verzia neznáma | Nie |
| `tools/list` a presné názvy/schémy | Neoverené | Žiadny nástroj |
| Vyhľadávanie, ceny, dostupnosť | Áno | Nie |
| Čítanie/zápis košíka | Správa košíka | Nie |
| Nákupné zoznamy, objednávky | Áno | Nie |

`src/lib/rohlik.ts` obsahuje rozhranie providera a pravdivé capability flags. Žiadny živý provider nie je zapnutý, tokeny sa neukladajú, OAuth success ani bezpečný sync sa nepredstierajú. Čistý výpočet rozdielov košíka je testovaný iba lokálne. Nie je to dokončený synchronizačný mechanizmus.

## Použiteľný fallback

Interný nákupný plán, checkboxy, kopírovanie, TXT/CSV export, české zadanie pre Rohlík a odkaz na oficiálnu aplikáciu v ChatGPT. Pripojenie v ChatGPT neposkytne token FREEZER OS. Zadanie výslovne žiada zachovať existujúci košík a neodosielať/neplatiť objednávku.

## Pred zapnutím priameho pripojenia

Získať dostupný discovery a autorizovať vlastného klienta podporovaným postupom; overiť transport, PKCE, redirect URI, scopes, refresh/revocation, tools/list a podmienky. Až podľa skutočných schém vytvoriť adapter. Potrebné je oddelené šifrované serverové úložisko tokenov a trvalý synchronizačný journal, čítanie košíka pred zápisom, potvrdenie diffu, obnova po čiastočnom zlyhaní a riešenie súbežných osobných úprav. Samotné opakované použitie lokálneho diffu túto záruku neposkytuje. Do osobného košíka sa v týchto testoch nezapisovalo.

Používateľ následne dodal aj návod pre ChatGPT Developer Mode a Claude: OAuth a `claude mcp add --transport http rohlik https://mcp.rohlik.cz/mcp`. Potvrdzuje dokumentovaný HTTP transport, ale neposkytuje registráciu, redirect URI ani tool schémy vlastnému Vercel klientovi. Staré prihlasovanie heslom v hlavičkách už podľa tohto návodu nie je podporované; FREEZER OS ho nepoužíva.
