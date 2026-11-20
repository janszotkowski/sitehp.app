## 1. Co navštívilo váš web {#what}

Někdo zadal adresu vašeho webu na sitehp.app a skener sitehp.app si jej jednou prohlédl zvenčí, aby mu přidělil skóre. Každý jeho požadavek nese tento user agent:

- `{{userAgent}}`

## 2. Co stahuje {#requests}

Sken odešle zhruba dvacet běžných požadavků, jaké odesílá prohlížeč nebo vyhledávač:

- zadanou stránku a tutéž stránku ještě jednou s žádostí o verzi v Markdownu,
- adresu s prostým http, aby ověřil, že přesměrovává na https, a variantu s www nebo bez něj,
- `/robots.txt`, `/llms.txt` a sitemapu (u indexu sitemap první sitemapu, kterou uvádí) a až tři stránky, které sitemapa uvádí,
- až tři skripty a styly, na které stránka odkazuje na vlastním webu, aby ověřil, zda jsou komprimované a cachované,
- pět malých souborů pod `/.well-known/` (katalog API, metadata OAuth a OpenID, kartu agenta), aby zjistil, zda se web popisuje AI agentům,
- jednu vymyšlenou adresu, aby ověřil, že chybějící stránka odpoví kódem 404,
- certifikát TLS, a to otevřením zabezpečeného spojení.

## 3. Co nikdy nedělá {#never}

Nepřihlašuje se, neodesílá formuláře, nespouští vaše skripty, nesleduje jiné odkazy než přesměrování a výše uvedené a nepokouší se o průnik. Z každé odpovědi přečte nejvýše 1 MB a po 10 sekundách to vzdá. Neposílá žádné cookies a žádné vaše neukládá.

## 4. Jak často {#limits}

Jednu doménu lze skenovat nejvýše 10krát za hodinu, od všech uživatelů dohromady. Pokud byla stejná adresa skenována v posledních několika minutách, zobrazí se znovu již vytvořený report a váš web se nekontaktuje.

## 5. robots.txt {#robots}

Sken je jediná návštěva, o kterou požádal člověk, nikoli procházení webu crawlerem, proto skener nerespektuje pravidla `Disallow`; váš robots.txt čte, aby o něm podal zprávu. Pokud nechcete být skenováni vůbec, požádejte o vyřazení níže.

## 6. Vyřazení vašeho webu {#exclusion}

Napište mi na {{contact}} a sdělte mi, jak mohu ověřit, že web provozujete (například soubor nebo DNS záznam, který vám určím), a přestanu jej skenovat, včetně jeho subdomén. Již provedené skeny zůstanou dostupné přes svůj odkaz, dokud po 30 dnech nevyprší, pokud mě nepožádáte, abych je smazal také.

## 7. Něco se pokazilo {#problems}

Pokud vám skener způsobil potíže nebo je nález o vašem webu chybný, napište mi na {{contact}}, uveďte adresu a čas a já se na to podívám.
