## 1. Kdo za zpracování odpovídá {#controller}

Službu sitehp.app provozuje {{controller}}, správce osobních údajů popsaných na této stránce. S čímkoli, co se této stránky týká, se na mě obraťte na {{contact}}.

## 2. Stručně {#summary}

sitehp.app nevyžaduje účet a nenastavuje žádné cookies. Nepoužívá žádné analytické, reklamní ani sledovací nástroje a nenačítá nic ze serverů jiných společností. To, co uchovávám, se týká webů, ne vás:

- report každého skenu, který si může přečíst kdokoli s jeho odkazem a který po 30 dnech mažu,
- seznam domén, jejichž sken si někdo vyžádal, s počty a posledním skóre, uchovávaný trvale,
- vaši IP adresu jen krátce, kvůli limitům požadavků, které brání zneužití skeneru.

## 3. Když skenujete web {#scan}

Ukládám adresu, kterou jste zadali, a report: skóre, nálezy a to, co skener na daném webu zjistil, včetně přijatých hlaviček odpovědi (bez cookies) a krátkých výňatků ze stránky: jejího titulku, popisu, hlavního nadpisu, nastavení viewportu a kanonické adresy. Cookies, které skenovaný web posílá, posuzuji, jejich hodnoty však nikdy neukládám. Hodnoty v části adresy s parametry (za `?`) před uložením nahrazuji znakem `…`, protože mohou obsahovat tokeny.

Report je dostupný každému, kdo má jeho odkaz, a je vyloučen z vyhledávačů. Spolu s jeho záznamem (logem) jej mažu 30 dnů po skenu.

Odděleně vedu seznam domén, jejichž sken si někdo vyžádal: pouze název domény (žádnou adresu stránky, žádné parametry, nic o tom, kdo o sken požádal), kdy byla doména poprvé a naposledy vyžádána, kolik bylo požadavků a skenů a poslední skóre. Uchovávám jej trvale, abych rozuměl tomu, jak je služba využívána, a abych ji i skenované weby chránili před zneužitím. Název domény obvykle není osobním údajem; pokud ten váš identifikuje vás a přejete si jeho odstranění, napište mi.

Právním základem je můj oprávněný zájem na poskytování služby, o kterou jste požádali, a na jejím zabezpečení (čl. 6 odst. 1 písm. f) GDPR).

## 4. Vaše IP adresa {#ip-address}

Při každém skenu můj server navštíví web někoho jiného, proto omezuji, kolik skenů může jedna adresa spustit. Abych je mohl počítat, slouží vaše IP adresa (u IPv6 také sítě /64 a /48, do kterých patří) jako klíč počítadla v mém úložišti limitů požadavků; uchovává se po dobu trvání limitního okna, tedy jednu hodinu, a poté se smaže. Dokud je otevřený živý report, počítám také otevřená spojení na jednu adresu.

Požadavek na sken, který zopakujete do deseti minut, rozpoznám podle vaší adresy, skenované adresy a náhodného klíče, který posílá váš prohlížeč; tyto údaje uchovávám po těchto deset minut.

Vaši IP adresu nezapisuji do svých logů a nikdy ji neukládám spolu s reportem. Právním základem je můj oprávněný zájem na ochraně služby a skenovaných webů před zneužitím (čl. 6 odst. 1 písm. f) GDPR).

## 5. Provozní logy {#logs}

Kvůli provozu a zabezpečení služby server zaznamenává každý požadavek: čas, druh požadavku, kterou část webu se týkal (odkazy na reporty zkrácené tak, aby je nebylo možné znovu použít), výsledek a dobu zpracování a identifikaci prohlížeče (user agent). U skenu se zaznamenává pouze název skenovaného webu a délka adresy, nikdy celá adresa ani to, co jste zadali.

Logy uchovávám jen tak dlouho, jak je nutné pro provoz a zabezpečení služby, nejdéle 30 dnů.

## 6. Když mi napíšete {#email}

Pokud mi napíšete, váš kontakt a zprávu použiji pouze k tomu, abych vám odpověděl a vyřídil váš požadavek. Právním základem je můj oprávněný zájem na odpovědi, případně provedení opatření přijatých před uzavřením smlouvy na vaši žádost (čl. 6 odst. 1 písm. b) a f) GDPR). Korespondenci uchovávám po dobu potřebnou k jejímu vyřízení, nejdéle 12 měsíců od posledního kontaktu, pokud nenásleduje uzavření smlouvy.

## 7. Kdo další s údaji pracuje {#recipients}

Údaje neprodávám ani je nikomu nepředávám pro jeho vlastní účely. Můj poskytovatel hostingu je zpracovává mým jménem na základě smlouvy, jako zpracovatel. Dávám přednost poskytovatelům v Evropském hospodářském prostoru; je-li poskytovatel mimo něj, opírám se o zákonný mechanismus předávání, například o standardní smluvní doložky Evropské komise.

Službu hostuje společnost Hetzner Online GmbH (Německo, [hetzner.com](https://www.hetzner.com)). Server, databáze a logy služby běží v jejím datovém centru v Evropské unii, takže žádné údaje neopouštějí Evropský hospodářský prostor.

## 8. Žádná rozhodnutí o vás {#decisions}

Skóre popisuje web, ne osobu. Neprovádím o vás žádné automatizované rozhodování a nevytvářím váš profil.

## 9. Vaše práva {#rights}

Máte právo na přístup k osobním údajům, které o vás zpracovávám, na jejich opravu nebo výmaz, na omezení zpracování, na přenositelnost údajů a právo vznést námitku proti zpracování založenému na mém oprávněném zájmu. Žádost pošlete na {{contact}}; odpovím do jednoho měsíce.

Pokud se domníváte, že porušuji pravidla, můžete podat stížnost u Úřadu pro ochranu osobních údajů (Pplk. Sochora 27, 170 00 Praha 7, [uoou.gov.cz](https://uoou.gov.cz)).

## 10. Změny {#changes}

Když se tyto zásady podstatně změní, aktualizuji datum v záhlaví stránky.
