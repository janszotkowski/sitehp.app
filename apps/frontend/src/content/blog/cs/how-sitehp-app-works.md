sitehp.app vezme adresu webu a za pár sekund mu dá skóre od 0 do 100 s krátkým seznamem toho, co opravit nejdřív. Tento článek popisuje, co se děje mezi tím, pro každého, kdo chce vědět, z čeho se to číslo skládá, než mu uvěří.

## Na co se sken dívá

Sken se na web dívá zvenku, tak jak ho potká návštěvník, vyhledávač nebo AI agent. Nepřihlašuje se, nespouští skripty webu a nesahá na nic, co není veřejné. Každá kontrola je malá a odpovídá na jednu otázku, třeba „přesměrovává web obyčejné `http` na `https`?“ nebo „má stránka právě jeden hlavní nadpis?“.

Kontroly dnes spadají do čtyř oblastí:

| Oblast     | Na co se ptá                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Bezpečnost | HTTPS a jeho certifikát, bezpečnostní hlavičky, příznaky cookies, smíšený obsah                    |
| Rychlost   | Doba do prvního bajtu, komprese, cache, váha stránky, zdroje blokující vykreslení                  |
| SEO        | Titulky a popisky, nadpisy, kanonická adresa, `robots.txt`, sitemapa, náhledy na sociálních sítích |
| AI agenti  | Jestli smějí AI crawlery web číst a jestli jim nabízí čistý text, například `llms.txt`             |

Každá kontrola skončí jako v pořádku, varování, chyba, nebo přeskočeno. Přeskočeno neznamená chybu: web bez sitemapy se nehodnotí podle jejího obsahu.

## Od adresy k reportu

Když kliknete na Skenovat, prohlížeč pošle adresu do API:

```http
POST /v1/scans
Content-Type: application/json

{ "url": "https://example.com" }
```

API adresu zkontroluje, uplatní limity požadavků (viz níže), uloží nový sken a zařadí ho do fronty. Hned odpoví odkazem na report a nečeká, až sken proběhne.

Sken z fronty převezme samostatný worker. Stránku stáhne jednou, spolu s několika malými soubory kolem ní (`robots.txt`, sitemapa, vzorek skriptů a stylů), a na tom, co stáhl, spustí všechny kontroly. Stránka, kterou sledujete, se plní živě: každá dokončená kontrola se do prohlížeče posílá hned, jak doběhne, přes proud server-sent events.

Pokud byla stejná adresa skenována v posledních deseti minutách, dostanete zpět ten výsledek místo nového skenu. Populární web se tak nestahuje pořád dokola.

## Jak vzniká skóre

Každá kontrola má závažnost (kritická, vysoká, střední nebo nízká) a každá oblast má váhu. Chyba stojí body podle své závažnosti, varování stojí méně a skóre oblastí se podle vah spojí do HP skóre.

Jedno pravidlo má přednost před aritmetikou. Neúspěšná kritická kontrola, třeba nedůvěryhodný certifikát nebo stránka, která vyhledávačům říká, ať ji neindexují, drží skóre nejvýš na 59, ať zbytek dopadne jakkoli dobře. Web s rozbitým certifikátem není „celkem v pořádku“.

Přesné váhy a všechny kontroly najdete na stránce [Jak se hodnotí](/cs/methodology) a model má číslo verze, které se mění pokaždé, když se změní hodnocení.

## Jak skener držím v bezpečí

Nástroj, který stáhne jakoukoli adresu, kterou napíše cizí člověk, svádí ke zneužití. Poctivý ho drží tři pravidla:

- **Jen veřejný internet.** Před každým spojením a znovu po každém přesměrování skener ověří, že adresa, na kterou se chystá, je veřejná. Privátní sítě, vlastní adresu stroje a metadatové služby cloudu odmítne.
- **Limity požadavků.** Z jedné adresy lze spustit 20 skenů za hodinu a jednu doménu lze skenovat 10krát za hodinu, ať se ptá kdokoli. Nikdo tak nemůže sitehp.app použít k zahlcení cizího webu.
- **Skener, který říká, kdo je.** Každý požadavek nese user agent `sitehp.app-scanner/1.0` a stránka [pro majitele webů](/cs/website-owners) vysvětluje, jak požádat o vynechání.

## Co uchovávám

Report je dostupný každému, kdo má jeho odkaz, a vyhledávače ho neindexují. Smaže se 30 dní po skenu. Část adresy s parametry (query) se před uložením skryje, protože může obsahovat tokeny. Podrobnosti jsou v [zásadách ochrany osobních údajů](/cs/privacy).

## Co bude dál

Chystám další kontroly: nastavení e-mailu a domény, soukromí (trackery a cookie lišty) a hlubší měření rychlosti. Každá se objeví v reportu a na stránce Jak se hodnotí, až bude hotová, nikdy dřív.
