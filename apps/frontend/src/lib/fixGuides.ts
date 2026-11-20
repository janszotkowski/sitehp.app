import type { Technology } from '@sitehp.app/core/browser';
import type { Locale } from '@lib/i18n/switchLocalePath';

/** One way to fix a finding: a few steps, usually a snippet to copy, and what to watch for. The prose is in the page language; the snippet is code and stays as it is. */
export type Guide = {
    steps: readonly string[];
    snippet?: { language: string; code: string };
    /** What can go wrong, shown as "Before you deploy". */
    risk?: string;
};

/** A prose string in every language of the site. */
type Text = Record<Locale, string>;

const t = (en: string, cs: string): Text => ({ en, cs });

/** A guide as written here, with every prose string in all languages; {@link guideTabs} picks one. */
type GuideSource = {
    steps: readonly Text[];
    snippet?: { language: string; code: string };
    risk?: Text;
};

/** The guide that fits any site, and the ones that fit a detected platform better. Snippets are templates: they never carry anything from the scanned site. */
export type CheckGuides = { generic: GuideSource; platforms?: Partial<Record<Technology, GuideSource>> };

const NGINX_RISK = t(
    'An add_header inside a location block replaces the ones set in the server block, so repeat the line there if you use one. Run nginx -t before every reload.',
    'Direktiva add_header uvnitř bloku location nahradí ty, které jsou nastavené v bloku server, takže pokud location používáte, zopakujte řádek i tam. Před každým novým načtením konfigurace spusťte nginx -t.',
);
const RELOAD_NGINX = t(
    'Test the configuration with nginx -t, then reload with systemctl reload nginx.',
    'Otestujte konfiguraci příkazem nginx -t a pak ji znovu načtěte příkazem systemctl reload nginx.',
);
const SCAN_AGAIN = t('Open the site, then scan it again to confirm.', 'Otevřete web a pak ho pro kontrolu oskenujte znovu.');

const htaccess = (lines: string): string => `<IfModule mod_headers.c>\n${lines}\n</IfModule>`;

const nextHeaders = (name: string, value: string): string =>
    `// next.config.js\nmodule.exports = {\n  async headers() {\n    return [\n      {\n        source: '/(.*)',\n        headers: [{ key: ${JSON.stringify(name)}, value: ${JSON.stringify(value)} }],\n      },\n    ];\n  },\n};`;

/** A response header: the same line for any site, and where to put it on nginx, Apache, Next.js and WordPress. */
const headerGuides = (name: string, value: string, risk?: Text, extra: Partial<Record<Technology, GuideSource>> = {}): CheckGuides => ({
    generic: {
        steps: [
            t(`Make your server send the ${name} header with every page.`, `Nastavte server tak, aby s každou stránkou posílal hlavičku ${name}.`),
            t('Use the value below as a start.', 'Jako výchozí bod použijte hodnotu níže.'),
            SCAN_AGAIN,
        ],
        snippet: { language: 'http', code: `${name}: ${value}` },
        ...(risk === undefined ? {} : { risk }),
    },
    platforms: {
        nginx: {
            steps: [
                t('Open the server block that listens on port 443, usually in /etc/nginx/sites-enabled/.', 'Otevřete blok server, který naslouchá na portu 443, obvykle v /etc/nginx/sites-enabled/.'),
                t('Add the line below inside it.', 'Přidejte do něj řádek níže.'),
                RELOAD_NGINX,
            ],
            snippet: { language: 'nginx', code: `add_header ${name} "${value}" always;` },
            risk: NGINX_RISK,
        },
        apache: {
            steps: [
                t('Make sure mod_headers is on (a2enmod headers).', 'Ověřte, že je zapnutý mod_headers (a2enmod headers).'),
                t('Add the lines below to the virtual host or to .htaccess.', 'Přidejte řádky níže do virtual hostu nebo do .htaccess.'),
                t('Reload Apache (systemctl reload apache2).', 'Znovu načtěte konfiguraci Apache (systemctl reload apache2).'),
            ],
            snippet: { language: 'apache', code: htaccess(`    Header always set ${name} "${value}"`) },
        },
        nextjs: {
            steps: [
                t('Open next.config.js (or next.config.mjs).', 'Otevřete next.config.js (nebo next.config.mjs).'),
                t('Add a headers() function like the one below.', 'Přidejte funkci headers() podle ukázky níže.'),
                t(
                    'Rebuild and restart or redeploy, because the config is read when the app starts.',
                    'Aplikaci znovu sestavte a restartujte nebo nasaďte, protože konfigurace se čte při jejím startu.',
                ),
            ],
            snippet: { language: 'js', code: nextHeaders(name, value) },
        },
        wordpress: {
            steps: [
                t('WordPress itself has no setting for response headers.', 'Samotný WordPress nemá pro hlavičky odpovědi žádné nastavení.'),
                t(
                    'Add the header at the web server: use the Apache snippet in .htaccess, or the nginx one if your host runs nginx. A security-headers plugin or your host’s panel can do the same.',
                    'Přidejte hlavičku na webovém serveru: použijte ukázku pro Apache v .htaccess, nebo tu pro nginx, pokud váš hosting běží na nginx. Totéž zvládne plugin pro bezpečnostní hlavičky nebo administrace vašeho hostingu.',
                ),
                SCAN_AGAIN,
            ],
            snippet: { language: 'apache', code: htaccess(`    Header always set ${name} "${value}"`) },
            ...(risk === undefined ? {} : { risk }),
        },
        ...extra,
    },
});

const cookieFlag = (flag: string, value: string, risk: Text): CheckGuides => ({
    generic: {
        steps: [
            t(`Add ${flag} to the Set-Cookie header of every cookie your site sets.`, `Přidejte ${flag} do hlavičky Set-Cookie u každé cookie, kterou váš web nastavuje.`),
            t(
                'Most frameworks and PHP have a setting for it (session.cookie_secure, session.cookie_httponly and session.cookie_samesite in php.ini).',
                'Většina frameworků i PHP na to má nastavení (session.cookie_secure, session.cookie_httponly a session.cookie_samesite v php.ini).',
            ),
            t('Check the cookie names in the finding to see which ones lack it.', 'Podle názvů cookies v nálezu zjistíte, kterým to chybí.'),
        ],
        snippet: { language: 'http', code: `Set-Cookie: name=value; ${value}` },
        risk,
    },
    platforms: {
        nginx: {
            steps: [
                t(
                    'If the cookie comes from an app behind nginx, add a flag to every cookie it sets (needs nginx 1.19.3 or newer).',
                    'Pokud cookie nastavuje aplikace za nginx, přidejte příznak ke každé cookie, kterou posílá (vyžaduje nginx 1.19.3 nebo novější).',
                ),
                t('Put the line below in the location that proxies to the app.', 'Vložte řádek níže do bloku location, který předává požadavky aplikaci.'),
                RELOAD_NGINX,
            ],
            snippet: { language: 'nginx', code: `proxy_cookie_flags ~ ${flag === 'Secure' ? 'secure' : flag === 'HttpOnly' ? 'httponly' : 'samesite=lax'};` },
            risk,
        },
    },
});

const seoTags = (steps: readonly Text[], snippet: string, platforms: CheckGuides['platforms']): CheckGuides => ({
    generic: { steps, snippet: { language: 'html', code: snippet } },
    ...(platforms === undefined ? {} : { platforms }),
});

const seoPlugin = (what: Text): GuideSource => ({
    steps: [
        t('Use an SEO plugin such as Yoast SEO or Rank Math, or your theme’s SEO settings.', 'Použijte SEO plugin, například Yoast SEO nebo Rank Math, nebo SEO nastavení vaší šablony.'),
        t(`Edit the page and fill in the ${what.en} in the plugin’s box.`, `Upravte stránku a v poli pluginu vyplňte ${what.cs}.`),
        t('Update the page, then scan again.', 'Stránku aktualizujte a pak ji znovu oskenujte.'),
    ],
});

const SHOPIFY_LISTING = [
    t('Open the page, product or collection in the admin.', 'Otevřete v administraci stránku, produkt nebo kolekci.'),
    t('Scroll to Search engine listing and choose Edit.', 'Sjeďte k části Search engine listing a zvolte Edit.'),
];

const APP_ROUTER_METADATA = t('In the App Router, export metadata from the page or layout.', 'V App Routeru exportujte metadata ze stránky nebo layoutu.');

const CACHE_PLUGINS = 'WP Rocket, LiteSpeed Cache, W3 Total Cache';

export const fixGuides: Record<string, CheckGuides> = {
    hsts: headerGuides(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
        t(
            'A browser remembers this rule for the whole max-age. If https breaks later, visitors cannot reach the site until it runs out, and includeSubDomains covers every subdomain too. Start with max-age=300, check, then raise it.',
            'Prohlížeč si toto pravidlo pamatuje po celou dobu max-age. Pokud https později přestane fungovat, návštěvníci se na web nedostanou, dokud doba nevyprší, a includeSubDomains se týká i všech subdomén. Začněte s max-age=300, ověřte, že vše funguje, a pak hodnotu zvyšte.',
        ),
        {
            cloudflare: {
                steps: [
                    t('In the Cloudflare dashboard open SSL/TLS, then Edge Certificates.', 'V administraci Cloudflare otevřete SSL/TLS a pak Edge Certificates.'),
                    t('Turn on HTTP Strict Transport Security (HSTS).', 'Zapněte HTTP Strict Transport Security (HSTS).'),
                    t('Choose a max age of 6 months or more, then save.', 'Zvolte max age alespoň 6 měsíců a uložte.'),
                ],
                risk: t('Only turn it on when every page and subdomain works over https.', 'Zapněte to, až když každá stránka i subdoména funguje přes https.'),
            },
        },
    ),
    csp: headerGuides(
        'Content-Security-Policy-Report-Only',
        "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
        t(
            'An enforcing policy blocks inline scripts and any source it does not list, and can break features. Start in report-only mode: open the site with the browser console open, allow each legitimate source you see reported, and only then rename the header to Content-Security-Policy.',
            'Vynucovaná politika blokuje inline skripty a každý zdroj, který v ní není, a může rozbít některé funkce. Začněte v režimu report-only: otevřete web s otevřenou konzolí prohlížeče, povolte každý legitimní zdroj, který se v ní objeví, a teprve pak hlavičku přejmenujte na Content-Security-Policy.',
        ),
    ),
    x_frame_options: headerGuides(
        'X-Frame-Options',
        'SAMEORIGIN',
        t(
            'If other sites embed your pages on purpose (a widget, a partner portal), they stop working. Use a CSP frame-ancestors rule that lists them instead.',
            'Pokud jiné weby vaše stránky záměrně vkládají (widget, partnerský portál), přestane jim to fungovat. Místo toho použijte pravidlo CSP frame-ancestors, které je vyjmenuje.',
        ),
    ),
    x_content_type_options: headerGuides(
        'X-Content-Type-Options',
        'nosniff',
        t(
            'Files served with a wrong Content-Type (a script as text/plain) stop working. Fix the type rather than the header.',
            'Soubory poslané se špatným Content-Type (skript jako text/plain) přestanou fungovat. Opravte typ, ne hlavičku.',
        ),
    ),
    referrer_policy: headerGuides(
        'Referrer-Policy',
        'strict-origin-when-cross-origin',
        t(
            'Analytics that rely on the full address of the previous page will see only the domain from other sites.',
            'Analytika, která spoléhá na celou adresu předchozí stránky, uvidí u návštěv z jiných webů jen doménu.',
        ),
    ),
    permissions_policy: headerGuides(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
        t(
            'List only features your site never uses. A feature set to () is switched off for the page and any frames in it.',
            'Uveďte jen funkce, které váš web nikdy nepoužívá. Funkce nastavená na () je vypnutá pro stránku i pro všechny rámce v ní.',
        ),
    ),
    http_redirect: {
        generic: {
            steps: [
                t('Install a valid certificate, so the site answers on https.', 'Nainstalujte platný certifikát, aby web odpovídal na https.'),
                t(
                    'Redirect every plain-http request to the same address on https with a permanent (301) redirect.',
                    'Každý požadavek přes nešifrované http přesměrujte na stejnou adresu s https trvalým přesměrováním (301).',
                ),
                SCAN_AGAIN,
            ],
            risk: t(
                'Test the https site first: a redirect to a page that does not load locks visitors out.',
                'Nejdřív otestujte web na https: přesměrování na stránku, která se nenačte, návštěvníky zablokuje.',
            ),
        },
        platforms: {
            nginx: {
                steps: [t('Add a server block for port 80 that only redirects.', 'Přidejte blok server pro port 80, který jen přesměrovává.'), RELOAD_NGINX],
                snippet: { language: 'nginx', code: 'server {\n  listen 80;\n  server_name example.com www.example.com;\n  return 301 https://$host$request_uri;\n}' },
            },
            apache: {
                steps: [
                    t('Make sure mod_rewrite is on (a2enmod rewrite).', 'Ověřte, že je zapnutý mod_rewrite (a2enmod rewrite).'),
                    t('Add the lines below to the port-80 virtual host or to .htaccess.', 'Přidejte řádky níže do virtual hostu pro port 80 nebo do .htaccess.'),
                    t('Reload Apache.', 'Znovu načtěte konfiguraci Apache.'),
                ],
                snippet: { language: 'apache', code: 'RewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]' },
            },
            cloudflare: {
                steps: [
                    t('In the Cloudflare dashboard open SSL/TLS, then Edge Certificates.', 'V administraci Cloudflare otevřete SSL/TLS a pak Edge Certificates.'),
                    t('Turn on Always Use HTTPS.', 'Zapněte Always Use HTTPS.'),
                ],
                risk: t(
                    'Use the Full (strict) SSL mode, so the link to your own server is encrypted too.',
                    'Použijte režim SSL Full (strict), aby bylo šifrované i spojení s vaším vlastním serverem.',
                ),
            },
            wordpress: {
                steps: [
                    t(
                        'Open Settings, then General, and change both WordPress Address and Site Address to start with https://.',
                        'Otevřete Nastavení a pak Obecné a změňte Adresu WordPressu i Adresu webu tak, aby začínaly https://.',
                    ),
                    t(
                        'Add the redirect at the web server (the nginx or Apache tab) or turn it on in your host’s panel.',
                        'Přidejte přesměrování na webovém serveru (záložka nginx nebo Apache), nebo ho zapněte v administraci hostingu.',
                    ),
                    SCAN_AGAIN,
                ],
            },
        },
    },
    seo_title: seoTags(
        [
            t('Give every page its own <title> of 30 to 60 characters.', 'Dejte každé stránce vlastní <title> o délce 30 až 60 znaků.'),
            t('Put the main topic first and the brand last.', 'Hlavní téma dejte na začátek a značku na konec.'),
            SCAN_AGAIN,
        ],
        '<title>Winter tyres for small cars | Example Shop</title>',
        {
            wordpress: seoPlugin(t('SEO title', 'SEO titulek')),
            nextjs: {
                steps: [APP_ROUTER_METADATA, t('Keep the title between 30 and 60 characters.', 'Titulek držte mezi 30 a 60 znaky.')],
                snippet: { language: 'js', code: "export const metadata = {\n  title: 'Winter tyres for small cars | Example Shop',\n};" },
            },
            shopify: {
                steps: [
                    ...SHOPIFY_LISTING,
                    t('Fill in the page title (30 to 60 characters).', 'Vyplňte titulek stránky (30 až 60 znaků).'),
                    t('For the home page: Online Store, Preferences, Title.', 'Pro domovskou stránku: Online Store, Preferences, Title.'),
                ],
            },
        },
    ),
    meta_description: seoTags(
        [
            t('Write a description of 70 to 160 characters for every page.', 'Pro každou stránku napište popis o délce 70 až 160 znaků.'),
            t('Say what the page offers, in a sentence a person would click.', 'Řekněte, co stránka nabízí, větou, na kterou by člověk klikl.'),
            SCAN_AGAIN,
        ],
        '<meta name="description" content="Winter tyres for small cars, in stock, with free fitting in Ostrava.">',
        {
            wordpress: seoPlugin(t('meta description', 'meta popis')),
            nextjs: {
                steps: [APP_ROUTER_METADATA, t('Keep the description between 70 and 160 characters.', 'Popis držte mezi 70 a 160 znaky.')],
                snippet: { language: 'js', code: "export const metadata = {\n  description: 'Winter tyres for small cars, in stock, with free fitting.',\n};" },
            },
            shopify: { steps: [...SHOPIFY_LISTING, t('Fill in the meta description (70 to 160 characters).', 'Vyplňte meta popis (70 až 160 znaků).')] },
        },
    ),
    canonical: seoTags(
        [
            t('Add one canonical link in the <head> of every page.', 'Do <head> každé stránky přidejte jeden kanonický odkaz.'),
            t(
                'Use the full address of the version you want to be found, with https and the host you prefer.',
                'Použijte celou adresu verze, kterou chcete nechat najít, s https a s podobou domény, kterou preferujete.',
            ),
            t('Do not point it at a different page unless that page is the real original.', 'Nesměrujte ho na jinou stránku, pokud ta není skutečným originálem.'),
        ],
        '<link rel="canonical" href="https://example.com/winter-tyres">',
        {
            wordpress: {
                steps: [
                    t('WordPress adds a canonical link on its own.', 'WordPress přidává kanonický odkaz sám.'),
                    t(
                        'If it is missing or wrong, an SEO plugin or the theme is changing it: check the plugin’s canonical setting for the page.',
                        'Pokud chybí nebo je špatně, mění ho SEO plugin nebo šablona: zkontrolujte u stránky nastavení kanonické adresy v pluginu.',
                    ),
                ],
            },
            nextjs: {
                steps: [
                    t('In the App Router, set metadataBase once in the root layout.', 'V App Routeru nastavte metadataBase jednou v kořenovém layoutu.'),
                    t('Export alternates.canonical from each page.', 'Z každé stránky exportujte alternates.canonical.'),
                ],
                snippet: { language: 'js', code: "export const metadata = {\n  alternates: { canonical: '/winter-tyres' },\n};" },
            },
            shopify: {
                steps: [
                    t(
                        'Themes normally output it. Open Online Store, then Edit code, and look at theme.liquid.',
                        'Šablony ho obvykle vypisují. Otevřete Online Store, pak Edit code a podívejte se do theme.liquid.',
                    ),
                    t('If it is missing, add the line below inside <head>.', 'Pokud chybí, přidejte řádek níže dovnitř <head>.'),
                ],
                snippet: { language: 'liquid', code: '<link rel="canonical" href="{{ canonical_url }}">' },
            },
        },
    ),
    open_graph: seoTags(
        [
            t('Add the four Open Graph tags to the <head>: title, description, image and url.', 'Do <head> přidejte čtyři značky Open Graph: title, description, image a url.'),
            t('Use a full address for the image, about 1200 by 630 pixels.', 'Pro obrázek použijte celou adresu, velikost zhruba 1200 × 630 pixelů.'),
            SCAN_AGAIN,
        ],
        '<meta property="og:title" content="Winter tyres for small cars">\n<meta property="og:description" content="In stock, with free fitting.">\n<meta property="og:image" content="https://example.com/share.jpg">\n<meta property="og:url" content="https://example.com/winter-tyres">',
        {
            wordpress: seoPlugin(t('social (Open Graph) title, description and image', 'titulek, popis a obrázek pro sociální sítě (Open Graph)')),
            nextjs: {
                steps: [t('In the App Router, export metadata with an openGraph object.', 'V App Routeru exportujte metadata s objektem openGraph.')],
                snippet: {
                    language: 'js',
                    code: "export const metadata = {\n  openGraph: {\n    title: 'Winter tyres for small cars',\n    description: 'In stock, with free fitting.',\n    url: '/winter-tyres',\n    images: ['/share.jpg'],\n  },\n};",
                },
            },
            shopify: {
                steps: [
                    t('Most themes add these tags on their own.', 'Většina šablon tyto značky přidává sama.'),
                    t('Set a Social sharing image under Online Store, then Preferences.', 'Obrázek pro sdílení (Social sharing image) nastavte v Online Store, pak Preferences.'),
                    t('Titles and descriptions come from the Search engine listing of each page.', 'Titulky a popisy se berou z části Search engine listing u každé stránky.'),
                ],
            },
        },
    ),
    cookie_secure: cookieFlag(
        'Secure',
        'Secure',
        t(
            'A Secure cookie is sent only over https. Make sure the whole site runs on https first, or visitors lose their session.',
            'Cookie s příznakem Secure se posílá jen přes https. Nejdřív zajistěte, aby celý web běžel na https, jinak návštěvníci přijdou o přihlášení.',
        ),
    ),
    cookie_httponly: cookieFlag(
        'HttpOnly',
        'HttpOnly',
        t('A cookie that your own JavaScript reads cannot be HttpOnly. Leave those alone.', 'Cookie, kterou čte váš vlastní JavaScript, nemůže být HttpOnly. Takové cookies nechte, jak jsou.'),
    ),
    cookie_samesite: cookieFlag(
        'SameSite',
        'SameSite=Lax',
        t(
            'SameSite=Strict can log people out when they arrive from a link. SameSite=None needs Secure and is meant for embeds.',
            'SameSite=Strict může odhlásit lidi, kteří přijdou z odkazu. SameSite=None vyžaduje Secure a je určené pro vložený obsah.',
        ),
    ),
    compression: {
        generic: {
            steps: [
                t(
                    'Turn on gzip or Brotli on your server or CDN for text files: HTML, CSS, JavaScript, JSON and SVG.',
                    'Na serveru nebo CDN zapněte gzip nebo Brotli pro textové soubory: HTML, CSS, JavaScript, JSON a SVG.',
                ),
                t('Do not compress images or video, they are already compressed.', 'Obrázky ani video nekomprimujte, komprimované už jsou.'),
                SCAN_AGAIN,
            ],
        },
        platforms: {
            nginx: {
                steps: [t('Add the lines below to the http or server block.', 'Přidejte řádky níže do bloku http nebo server.'), RELOAD_NGINX],
                snippet: { language: 'nginx', code: 'gzip on;\ngzip_min_length 1024;\ngzip_types text/css application/javascript application/json image/svg+xml;' },
                risk: t('text/html is compressed whenever gzip is on, so it is not listed.', 'text/html se při zapnutém gzip komprimuje vždy, proto v seznamu není.'),
            },
            apache: {
                steps: [
                    t('Make sure mod_deflate is on (a2enmod deflate).', 'Ověřte, že je zapnutý mod_deflate (a2enmod deflate).'),
                    t('Add the line below, then reload Apache.', 'Přidejte řádek níže a znovu načtěte konfiguraci Apache.'),
                ],
                snippet: { language: 'apache', code: 'AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml' },
            },
            nextjs: {
                steps: [
                    t('Next.js compresses responses by default (compress is true in next.config.js).', 'Next.js odpovědi ve výchozím nastavení komprimuje (compress je v next.config.js true).'),
                    t(
                        'If the page arrives uncompressed, look for compress: false in next.config.js and remove it.',
                        'Pokud stránka přichází nekomprimovaná, najděte v next.config.js compress: false a odstraňte to.',
                    ),
                ],
            },
            wordpress: {
                steps: [
                    t(
                        `Ask your host to turn on gzip or Brotli, or use a caching plugin (${CACHE_PLUGINS}) and switch on its compression option.`,
                        `Požádejte hosting o zapnutí gzip nebo Brotli, nebo použijte cachovací plugin (${CACHE_PLUGINS}) a zapněte v něm kompresi.`,
                    ),
                ],
            },
        },
    },
    cache_headers: {
        generic: {
            steps: [
                t('Send Cache-Control for static files: images, fonts, CSS and JavaScript.', 'Posílejte Cache-Control pro statické soubory: obrázky, fonty, CSS a JavaScript.'),
                t(
                    'Use a year for files whose name changes when they change (style.3f9a1c.css), and an hour or a day for the rest.',
                    'Soubory, jejichž název se při změně mění (style.3f9a1c.css), nechte cachovat rok, ostatní hodinu nebo den.',
                ),
                t('Do not cache the HTML page for long.', 'HTML stránku dlouho necachujte.'),
            ],
            snippet: { language: 'http', code: 'Cache-Control: public, max-age=31536000, immutable' },
            risk: t(
                'A long cache time on a file whose name does not change means visitors keep seeing the old version.',
                'Dlouhá doba cache u souboru, jehož název se nemění, znamená, že návštěvníci budou dál vidět starou verzi.',
            ),
        },
        platforms: {
            nginx: {
                steps: [t('Add a location for static files to the server block.', 'Přidejte do bloku server location pro statické soubory.'), RELOAD_NGINX],
                snippet: { language: 'nginx', code: 'location ~* \\.(?:css|js|woff2|png|jpe?g|webp|avif|svg)$ {\n  add_header Cache-Control "public, max-age=31536000, immutable";\n}' },
            },
            apache: {
                steps: [
                    t('Make sure mod_expires is on (a2enmod expires).', 'Ověřte, že je zapnutý mod_expires (a2enmod expires).'),
                    t('Add the lines below, then reload Apache.', 'Přidejte řádky níže a znovu načtěte konfiguraci Apache.'),
                ],
                snippet: {
                    language: 'apache',
                    code: '<IfModule mod_expires.c>\n  ExpiresActive On\n  ExpiresByType text/css "access plus 1 year"\n  ExpiresByType application/javascript "access plus 1 year"\n  ExpiresByType image/webp "access plus 1 month"\n</IfModule>',
                },
            },
            nextjs: {
                steps: [
                    t('Files under /_next/static are already cached for a year.', 'Soubory pod /_next/static se už cachují na rok.'),
                    t('For files in /public, add headers() to next.config.js for the folder.', 'Pro soubory v /public přidejte do next.config.js funkci headers() pro danou složku.'),
                ],
                snippet: {
                    language: 'js',
                    code: "// next.config.js\nmodule.exports = {\n  async headers() {\n    return [{ source: '/images/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] }];\n  },\n};",
                },
            },
            wordpress: {
                steps: [
                    t(
                        `Use a caching plugin (${CACHE_PLUGINS}) and switch on browser caching, or ask your host.`,
                        `Použijte cachovací plugin (${CACHE_PLUGINS}) a zapněte v něm cachování v prohlížeči, nebo se obraťte na hosting.`,
                    ),
                ],
            },
        },
    },
    http_version: {
        generic: {
            steps: [
                t('Turn on HTTP/2 on your server, or put the site behind a CDN that offers HTTP/2 and HTTP/3.', 'Zapněte na serveru HTTP/2, nebo web dejte za CDN, která nabízí HTTP/2 a HTTP/3.'),
                t('HTTP/2 needs https. Check that your certificate is valid first.', 'HTTP/2 vyžaduje https. Nejdřív ověřte, že je váš certifikát platný.'),
                SCAN_AGAIN,
            ],
        },
        platforms: {
            nginx: {
                steps: [
                    t('In the server block that listens on 443, turn on http2 (nginx 1.25.1 or newer).', 'V bloku server, který naslouchá na portu 443, zapněte http2 (nginx 1.25.1 nebo novější).'),
                    t('On older nginx, write it on the listen line: listen 443 ssl http2;', 'Ve starším nginx to napište na řádek listen: listen 443 ssl http2;'),
                    RELOAD_NGINX,
                ],
                snippet: { language: 'nginx', code: 'listen 443 ssl;\nhttp2 on;' },
            },
            apache: {
                steps: [
                    t('Enable mod_http2 (a2enmod http2) with the event MPM.', 'Zapněte mod_http2 (a2enmod http2) s MPM event.'),
                    t('Add the line below to the https virtual host, then reload Apache.', 'Přidejte řádek níže do virtual hostu pro https a znovu načtěte konfiguraci Apache.'),
                ],
                snippet: { language: 'apache', code: 'Protocols h2 http/1.1' },
            },
        },
    },
    coop: headerGuides(
        'Cross-Origin-Opener-Policy',
        'same-origin',
        t(
            'Pop-up windows that your site opens and that then talk back to it (a sign-in or payment pop-up) can stop working. If they do, use same-origin-allow-popups instead.',
            'Vyskakovací okna, která váš web otevírá a která s ním pak komunikují (přihlášení nebo platba), mohou přestat fungovat. Pokud se to stane, použijte místo toho same-origin-allow-popups.',
        ),
    ),
    info_leak: {
        generic: {
            steps: [
                t(
                    'Stop your server from announcing its software and version in the Server and X-Powered-By headers.',
                    'Zařiďte, aby server v hlavičkách Server a X-Powered-By neprozrazoval svůj software a verzi.',
                ),
                t('Use the setting for your stack from the tabs, or ask your host.', 'Použijte nastavení pro svou platformu ze záložek, nebo se obraťte na hosting.'),
                t('In PHP, set expose_php = Off in php.ini to remove X-Powered-By: PHP/….', 'V PHP nastavte v php.ini expose_php = Off, tím zmizí X-Powered-By: PHP/….'),
                SCAN_AGAIN,
            ],
        },
        platforms: {
            nginx: {
                steps: [t('Add the line below to the http block of nginx.conf.', 'Přidejte řádek níže do bloku http v nginx.conf.'), RELOAD_NGINX],
                snippet: { language: 'nginx', code: 'server_tokens off;' },
            },
            apache: {
                steps: [
                    t('Add the lines below to the main Apache configuration (they do not work in .htaccess).', 'Přidejte řádky níže do hlavní konfigurace Apache (v .htaccess nefungují).'),
                    t('Reload Apache.', 'Znovu načtěte konfiguraci Apache.'),
                ],
                snippet: { language: 'apache', code: 'ServerTokens Prod\nServerSignature Off' },
            },
            nextjs: {
                steps: [t('Turn the header off in next.config.js.', 'Vypněte hlavičku v next.config.js.')],
                snippet: { language: 'js', code: '// next.config.js\nmodule.exports = {\n  poweredByHeader: false,\n};' },
            },
        },
    },
    html_lang: {
        generic: {
            steps: [
                t('Set the lang attribute on the <html> tag to the language of the page, for example en or cs.', 'Nastavte atribut lang na značce <html> na jazyk stránky, například en nebo cs.'),
                t('Use the right language on each page of a multilingual site.', 'Na vícejazyčném webu použijte na každé stránce správný jazyk.'),
                SCAN_AGAIN,
            ],
            snippet: { language: 'html', code: '<html lang="en">' },
        },
        platforms: {
            wordpress: {
                steps: [
                    t('Open Settings, then General.', 'Otevřete Nastavení a pak Obecné.'),
                    t(
                        'Set Site Language to the language of your site and save. Themes write it into the <html> tag.',
                        'Nastavte Jazyk webu na jazyk vašeho webu a uložte. Šablony ho zapíšou do značky <html>.',
                    ),
                ],
            },
            nextjs: {
                steps: [t('Open the root layout (app/layout.tsx) and set lang on the <html> tag.', 'Otevřete kořenový layout (app/layout.tsx) a nastavte lang na značce <html>.')],
                snippet: { language: 'jsx', code: '<html lang="en">' },
            },
            shopify: {
                steps: [
                    t('Open Online Store, then Edit code, then theme.liquid.', 'Otevřete Online Store, pak Edit code a theme.liquid.'),
                    t('Set the lang attribute on the <html> tag as below.', 'Nastavte atribut lang na značce <html> podle ukázky níže.'),
                ],
                snippet: { language: 'liquid', code: '<html lang="{{ request.locale.iso_code }}">' },
            },
        },
    },
    h1: {
        generic: {
            steps: [
                t('Give each page exactly one <h1> that says what the page is about.', 'Dejte každé stránce právě jeden <h1>, který říká, o čem stránka je.'),
                t('Use <h2> and lower for the sections under it.', 'Pro sekce pod ním použijte <h2> a nižší úrovně.'),
                t('Check your template: a logo or a banner marked up as <h1> is a common second one.', 'Zkontrolujte šablonu: častým druhým <h1> bývá logo nebo banner.'),
            ],
            snippet: { language: 'html', code: '<h1>Winter tyres for small cars</h1>' },
        },
    },
    viewport: {
        generic: {
            steps: [
                t('Add the viewport tag to the <head> of every page.', 'Do <head> každé stránky přidejte značku viewport.'),
                t(
                    'Do not add user-scalable=no or a low maximum-scale: people who need larger text zoom in.',
                    'Nepřidávejte user-scalable=no ani nízké maximum-scale: lidé, kteří potřebují větší text, si stránku přibližují.',
                ),
                SCAN_AGAIN,
            ],
            snippet: { language: 'html', code: '<meta name="viewport" content="width=device-width, initial-scale=1">' },
        },
    },
    noindex: {
        generic: {
            steps: [
                t(
                    'Find where the noindex comes from: a <meta name="robots"> tag in the page, or an X-Robots-Tag header from the server.',
                    'Zjistěte, odkud noindex pochází: ze značky <meta name="robots"> ve stránce, nebo z hlavičky X-Robots-Tag ze serveru.',
                ),
                t('Remove it from every page that should appear in search.', 'Odstraňte ho ze všech stránek, které se mají objevit ve vyhledávání.'),
                t(
                    'Ask search engines to look again with the URL inspection in Google Search Console.',
                    'Požádejte vyhledávače o opětovné procházení přes nástroj Kontrola adresy URL v Google Search Console.',
                ),
            ],
            risk: t('A staging copy should stay noindex. Make sure you are changing the live site.', 'Testovací kopie webu má noindex mít dál. Ujistěte se, že měníte ostrý web.'),
        },
        platforms: {
            wordpress: {
                steps: [
                    t('Open Settings, then Reading.', 'Otevřete Nastavení a pak Zobrazování.'),
                    t('Untick “Discourage search engines from indexing this site” and save.', 'Zrušte zaškrtnutí „Požádat vyhledávače, aby neindexovaly tento web“ a uložte.'),
                    t('An SEO plugin can also set noindex on single pages, so check there too.', 'Noindex u jednotlivých stránek může nastavit i SEO plugin, zkontrolujte proto i ten.'),
                ],
            },
        },
    },
    twitter_card: {
        generic: {
            steps: [
                t('Add a twitter:card tag to the <head>.', 'Do <head> přidejte značku twitter:card.'),
                t('summary_large_image shows a big picture, summary a small one.', 'summary_large_image zobrazí velký obrázek, summary malý.'),
                SCAN_AGAIN,
            ],
            snippet: { language: 'html', code: '<meta name="twitter:card" content="summary_large_image">' },
        },
        platforms: {
            nextjs: {
                steps: [t('In the App Router, export metadata with a twitter object.', 'V App Routeru exportujte metadata s objektem twitter.')],
                snippet: { language: 'js', code: "export const metadata = {\n  twitter: { card: 'summary_large_image' },\n};" },
            },
        },
    },
    open_graph_quality: {
        generic: {
            steps: [
                t('Add the tags named in the finding.', 'Přidejte značky uvedené v nálezu.'),
                t(
                    'Make og:image a full address that starts with https://, and give it an og:image:alt text.',
                    'og:image zadejte jako celou adresu začínající https:// a doplňte k ní text og:image:alt.',
                ),
                SCAN_AGAIN,
            ],
            snippet: {
                language: 'html',
                code: '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Example Shop">\n<meta property="og:locale" content="en_US">\n<meta property="og:image:alt" content="Winter tyres on a small car">',
            },
        },
    },
    heading_order: {
        generic: {
            steps: [
                t(
                    'Go through the headings of the page in order: an <h2> is followed by an <h2> or an <h3>, never straight by an <h4>.',
                    'Projděte nadpisy stránky popořadě: po <h2> následuje <h2> nebo <h3>, nikdy rovnou <h4>.',
                ),
                t(
                    'Pick the level by the page’s outline, not by how large the text looks. Use CSS to change the size.',
                    'Úroveň volte podle osnovy stránky, ne podle toho, jak velký text vypadá. Velikost měňte v CSS.',
                ),
            ],
        },
    },
    img_alt: {
        generic: {
            steps: [
                t('Give every image that carries meaning an alt text that says what it shows.', 'Každému obrázku, který nese význam, dejte alternativní text (alt), který říká, co zobrazuje.'),
                t('For a purely decorative image use an empty alt (alt="") so screen readers skip it.', 'Čistě dekorativnímu obrázku dejte prázdný alt (alt=""), aby ho čtečky obrazovky přeskočily.'),
                SCAN_AGAIN,
            ],
            snippet: { language: 'html', code: '<img src="beans.jpg" alt="Brown paper bag of roasted coffee beans">' },
        },
        platforms: {
            wordpress: {
                steps: [
                    t('Open Media, then the image, and fill in Alternative Text.', 'Otevřete Média, pak obrázek, a vyplňte Alternativní text.'),
                    t('In the editor, select the image block and fill the same field in the sidebar.', 'V editoru vyberte blok obrázku a vyplňte stejné pole v postranním panelu.'),
                ],
            },
        },
    },
    img_dimensions: {
        generic: {
            steps: [
                t('Give every image width and height attributes in pixels, the real size of the file.', 'Dejte každému obrázku atributy width a height v pixelech podle skutečné velikosti souboru.'),
                t(
                    'Keep the image responsive with CSS (max-width: 100%; height: auto), so the browser can reserve the space before the image loads.',
                    'Responzivitu zachovejte v CSS (max-width: 100%; height: auto). Prohlížeč tak může místo pro obrázek vyhradit ještě před jeho načtením.',
                ),
            ],
            snippet: { language: 'html', code: '<img src="beans.jpg" width="800" height="600" alt="Coffee beans">' },
        },
        platforms: {
            nextjs: {
                steps: [
                    t(
                        'next/image needs width and height (or the fill prop), so use it instead of a plain <img>.',
                        'next/image vyžaduje width a height (nebo prop fill), takže ho použijte místo obyčejného <img>.',
                    ),
                ],
            },
        },
    },
    favicon: {
        generic: {
            steps: [
                t('Add a favicon file to your site, for example /favicon.ico.', 'Přidejte na web soubor favicon, například /favicon.ico.'),
                t('Link it from the <head> of every page.', 'Odkažte na něj v <head> každé stránky.'),
            ],
            snippet: { language: 'html', code: '<link rel="icon" href="/favicon.ico">' },
        },
        platforms: {
            wordpress: {
                steps: [
                    t('Open Appearance, then Customize, then Site Identity.', 'Otevřete Vzhled, pak Přizpůsobit a Identita webu.'),
                    t('Choose a Site Icon (a square image of at least 512 pixels) and publish.', 'Zvolte Ikonu webu (čtvercový obrázek o straně alespoň 512 pixelů) a publikujte.'),
                ],
            },
            nextjs: {
                steps: [t('Put a file named favicon.ico in the app folder. Next.js links it for you.', 'Vložte soubor favicon.ico do složky app. Next.js na něj odkáže sám.')],
            },
        },
    },
    json_ld: {
        generic: {
            steps: [
                t('Describe the page with structured data in a JSON-LD script, with a valid @type.', 'Popište stránku strukturovanými daty ve skriptu JSON-LD s platným @type.'),
                t('Every block must be valid JSON. One broken block is ignored.', 'Každý blok musí být platný JSON. Rozbitý blok se ignoruje.'),
                t('Check it with Google’s Rich Results Test.', 'Ověřte to v nástroji Rich Results Test od Googlu.'),
            ],
            snippet: {
                language: 'html',
                code: '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Example Shop",\n  "url": "https://example.com/",\n  "logo": "https://example.com/logo.png"\n}\n</script>',
            },
            risk: t(
                'Describe only what visitors can see on the page. Made-up data can make search engines ignore the markup.',
                'Popisujte jen to, co návštěvníci na stránce vidí. Kvůli vymyšleným údajům mohou vyhledávače strukturovaná data ignorovat.',
            ),
        },
    },
    hreflang: {
        generic: {
            steps: [
                t('On each language version, list all language versions, including the page itself.', 'Na každé jazykové verzi uveďte všechny jazykové verze, včetně stránky samotné.'),
                t('Add an x-default for the page that suits everyone else.', 'Přidejte x-default pro stránku, která se hodí pro všechny ostatní.'),
                t('The links must point both ways: every version links to every other.', 'Odkazy musí vést oběma směry: každá verze odkazuje na všechny ostatní.'),
            ],
            snippet: {
                language: 'html',
                code: '<link rel="alternate" hreflang="en" href="https://example.com/en/">\n<link rel="alternate" hreflang="cs" href="https://example.com/cs/">\n<link rel="alternate" hreflang="x-default" href="https://example.com/">',
            },
        },
    },
    robots_txt: {
        generic: {
            steps: [
                t(
                    'Create a plain-text file named robots.txt at the root of your site, so it opens at /robots.txt.',
                    'Vytvořte v kořeni webu textový soubor robots.txt, aby se otevřel na adrese /robots.txt.',
                ),
                t('Start with the lines below, and add rules only for paths you want crawlers to skip.', 'Začněte řádky níže a pravidla přidávejte jen pro cesty, které mají crawlery vynechat.'),
            ],
            snippet: { language: 'text', code: 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml' },
        },
        platforms: {
            nextjs: {
                steps: [t('In the App Router, add app/robots.ts that returns the rules.', 'V App Routeru přidejte soubor app/robots.ts, který vrací pravidla.')],
                snippet: {
                    language: 'js',
                    code: "export default function robots() {\n  return {\n    rules: { userAgent: '*', allow: '/' },\n    sitemap: 'https://example.com/sitemap.xml',\n  };\n}",
                },
            },
        },
    },
    robots_allows_page: {
        generic: {
            steps: [
                t('Open your robots.txt and find the Disallow line named in the finding.', 'Otevřete robots.txt a najděte řádek Disallow uvedený v nálezu.'),
                t('Remove it, or narrow it so it no longer matches this page.', 'Odstraňte ho, nebo ho zužte tak, aby se na tuto stránku už nevztahoval.'),
                t('Check the result in Google Search Console, in the robots.txt report.', 'Výsledek ověřte v Google Search Console v přehledu robots.txt.'),
            ],
            risk: t(
                'A blanket Disallow: / is often left over from a staging site. Check what the rule was meant to protect before removing it.',
                'Plošné Disallow: / často zůstane po testovacím webu. Než pravidlo odstraníte, zjistěte, co mělo chránit.',
            ),
        },
    },
    sitemap_xml: {
        generic: {
            steps: [
                t('Create a sitemap.xml at the root of your site that lists the pages you want found.', 'Vytvořte v kořeni webu sitemap.xml se seznamem stránek, které chcete nechat najít.'),
                t('Most platforms and SEO plugins can generate it, so look for that first.', 'Většina platforem a SEO pluginů ho umí vygenerovat, takže se nejdřív podívejte tam.'),
                t('Mention it in robots.txt.', 'Uveďte ho v robots.txt.'),
            ],
            snippet: {
                language: 'xml',
                code: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://example.com/</loc>\n  </url>\n</urlset>',
            },
        },
        platforms: {
            wordpress: {
                steps: [
                    t('WordPress 5.5 and newer creates a sitemap at /wp-sitemap.xml on its own.', 'WordPress 5.5 a novější vytváří sitemapu sám na adrese /wp-sitemap.xml.'),
                    t(
                        'SEO plugins such as Yoast and Rank Math make their own, usually at /sitemap_index.xml. Use one of them, and list it in robots.txt.',
                        'SEO pluginy jako Yoast a Rank Math vytvářejí vlastní, obvykle na /sitemap_index.xml. Používejte jen jednu z nich a uveďte ji v robots.txt.',
                    ),
                ],
            },
            nextjs: {
                steps: [t('In the App Router, add app/sitemap.ts that returns the pages.', 'V App Routeru přidejte soubor app/sitemap.ts, který vrací stránky.')],
                snippet: { language: 'js', code: "export default function sitemap() {\n  return [{ url: 'https://example.com/', lastModified: new Date() }];\n}" },
            },
        },
    },
    sitemap_in_robots: {
        generic: {
            steps: [
                t('Add a Sitemap line to robots.txt with the full address of your sitemap.', 'Přidejte do robots.txt řádek Sitemap s celou adresou vaší sitemapy.'),
                t('You can list several sitemaps, one per line.', 'Sitemap můžete uvést víc, každou na samostatném řádku.'),
            ],
            snippet: { language: 'text', code: 'Sitemap: https://example.com/sitemap.xml' },
        },
    },
    sitemap_urls: {
        generic: {
            steps: [
                t('Open the sitemap and try the addresses named in the finding.', 'Otevřete sitemapu a vyzkoušejte adresy uvedené v nálezu.'),
                t('Remove pages that no longer exist, that redirect elsewhere or that are marked noindex.', 'Odstraňte stránky, které už neexistují, přesměrovávají jinam nebo mají noindex.'),
                t('List each page by the address its canonical link names.', 'Každou stránku uveďte pod adresou, kterou uvádí její kanonický odkaz.'),
            ],
        },
    },
    redirect_chain: {
        generic: {
            steps: [
                t('Point every old address straight at the final one, with one permanent (301) redirect.', 'Každou starou adresu nasměrujte rovnou na konečnou, jedním trvalým přesměrováním (301).'),
                t('Update links and the sitemap to the final address, so nobody enters the chain.', 'Odkazy i sitemapu změňte na konečnou adresu, aby do řetězce nikdo nevstoupil.'),
                t(
                    'Use 301 or 308 for moves that are permanent. 302 tells search engines to keep the old address.',
                    'Pro trvalé přesuny použijte 301 nebo 308. Kód 302 říká vyhledávačům, aby si ponechaly starou adresu.',
                ),
            ],
        },
    },
    soft_404: {
        generic: {
            steps: [
                t(
                    'Make pages that do not exist answer with the status 404, not 200 and not a redirect to the home page.',
                    'Zařiďte, aby neexistující stránky odpovídaly stavem 404, ne 200 a ne přesměrováním na domovskou stránku.',
                ),
                t('You can still show a friendly page for the visitor. Only the status code has to say 404.', 'Návštěvníkovi můžete dál ukázat přívětivou stránku. Jen stavový kód musí být 404.'),
                SCAN_AGAIN,
            ],
        },
        platforms: {
            nginx: {
                steps: [t('Serve your error page with the 404 status.', 'Chybovou stránku posílejte se stavem 404.'), RELOAD_NGINX],
                snippet: { language: 'nginx', code: 'error_page 404 /404.html;' },
            },
            nextjs: {
                steps: [t('Call notFound() in the page when the content does not exist.', 'Když obsah neexistuje, zavolejte ve stránce notFound().')],
                snippet: { language: 'js', code: "import { notFound } from 'next/navigation';\n\nif (!post) notFound();" },
            },
        },
    },
    canonical_host: {
        generic: {
            steps: [
                t('Choose one host name for the site, with or without www.', 'Zvolte pro web jednu podobu domény, s www, nebo bez.'),
                t('Redirect the other one to it with a permanent (301) redirect, keeping the path.', 'Druhou podobu na ni přesměrujte trvalým přesměrováním (301) se zachováním cesty.'),
                t('Use the chosen host in your canonical links, sitemap and internal links.', 'Zvolenou podobu používejte v kanonických odkazech, sitemapě i interních odkazech.'),
            ],
        },
        platforms: {
            nginx: {
                steps: [t('Add a server block for the host name you do not want, that only redirects.', 'Pro nechtěnou podobu domény přidejte blok server, který jen přesměrovává.'), RELOAD_NGINX],
                snippet: {
                    language: 'nginx',
                    code: 'server {\n  listen 443 ssl;\n  server_name www.example.com;\n  # the same ssl_certificate lines as in your main server block\n  return 301 https://example.com$request_uri;\n}',
                },
            },
            apache: {
                steps: [
                    t('Add the lines below to the virtual host or to .htaccess.', 'Přidejte řádky níže do virtual hostu nebo do .htaccess.'),
                    t('Reload Apache.', 'Znovu načtěte konfiguraci Apache.'),
                ],
                snippet: { language: 'apache', code: 'RewriteEngine On\nRewriteCond %{HTTP_HOST} ^www\\.example\\.com$ [NC]\nRewriteRule ^ https://example.com%{REQUEST_URI} [L,R=301]' },
            },
        },
    },
    llms_txt: {
        generic: {
            steps: [
                t('Create a Markdown file named llms.txt at the root of your site.', 'Vytvořte v kořeni webu soubor llms.txt ve formátu Markdown.'),
                t(
                    'Start with a title line, then a one-line summary and links to your most useful pages.',
                    'Začněte řádkem s názvem, pak přidejte jednořádkové shrnutí a odkazy na své nejužitečnější stránky.',
                ),
                t('Use full addresses, so an assistant can follow the links.', 'Používejte celé adresy, aby asistent mohl odkazy otevřít.'),
            ],
            snippet: {
                language: 'markdown',
                code: '# Example Shop\n\n> A small shop selling winter tyres for small cars.\n\n## Pages\n\n- [Tyres](https://example.com/tyres): the full range\n- [Fitting](https://example.com/fitting): prices and booking',
            },
        },
    },
    ai_crawlers: {
        generic: {
            steps: [
                t('Open your robots.txt and find the rules aimed at the AI crawlers named in the finding.', 'Otevřete robots.txt a najděte pravidla pro AI crawlery uvedené v nálezu.'),
                t(
                    'Remove them or change them to Allow if you want those assistants to read your pages for the people who ask them.',
                    'Pokud chcete, aby tito asistenti četli vaše stránky pro lidi, kteří se jich ptají, pravidla odstraňte nebo je změňte na Allow.',
                ),
                SCAN_AGAIN,
            ],
            risk: t(
                'This is about assistants that fetch a page for a person asking a question. Whether crawlers may use your content for training is a separate choice, and the scan does not judge it.',
                'Jde o asistenty, kteří stáhnou stránku pro člověka, který se na něco ptá. Zda smějí crawlery používat váš obsah k trénování, je samostatné rozhodnutí a sken ho nehodnotí.',
            ),
        },
    },
    content_in_html: {
        generic: {
            steps: [
                t(
                    'Make your server send the text of the page in the HTML itself: server-side rendering or static generation.',
                    'Zařiďte, aby server posílal text stránky přímo v HTML: vykreslováním na serveru (SSR) nebo statickým generováním.',
                ),
                t(
                    'Content that scripts only add after the page loads is invisible to most AI agents and to some search engines.',
                    'Obsah, který skripty přidají až po načtení stránky, většina AI agentů a některé vyhledávače nevidí.',
                ),
                t('Check with “view source” in your browser: the text should be there.', 'Ověřte to přes „Zobrazit zdrojový kód stránky“ v prohlížeči: text tam má být.'),
            ],
        },
    },
    https_scheme: {
        generic: {
            steps: [
                t(
                    'Get a certificate. Let’s Encrypt issues them for free, and most hosts have a switch for it.',
                    'Pořiďte si certifikát. Let’s Encrypt ho vydává zdarma a většina hostingů na to má přepínač.',
                ),
                t('Install it on your server and make the site answer on https.', 'Nainstalujte ho na server a zařiďte, aby web odpovídal na https.'),
                t('Then redirect http to https so nobody lands on the plain address.', 'Pak přesměrujte http na https, aby nikdo neskončil na nešifrované adrese.'),
            ],
        },
    },
    cert_valid: {
        generic: {
            steps: [
                t(
                    'Read the reason in the finding: an expired certificate, a name that does not match, an incomplete chain or a self-signed one.',
                    'Přečtěte si v nálezu důvod: prošlý certifikát, nesouhlasící název, neúplný řetězec, nebo certifikát podepsaný sám sebou.',
                ),
                t(
                    'Issue a new certificate for the exact host name people use (for example both example.com and www.example.com).',
                    'Vystavte nový certifikát přesně pro názvy, které lidé používají (například example.com i www.example.com).',
                ),
                t(
                    'Install the full chain your certificate authority gives you, not only the single certificate file.',
                    'Nainstalujte celý řetězec, který vám dá certifikační autorita, ne jen samotný soubor certifikátu.',
                ),
            ],
        },
    },
    cert_expiry: {
        generic: {
            steps: [
                t('Renew the certificate now.', 'Certifikát hned obnovte.'),
                t(
                    'Set up automatic renewal so it does not happen again. With Let’s Encrypt, certbot does it for you.',
                    'Nastavte automatické obnovování, aby se to neopakovalo. U Let’s Encrypt to za vás udělá certbot.',
                ),
                t('Check that renewal works without waiting for the next expiry.', 'Ověřte, že obnovování funguje, a nečekejte s tím na další vypršení.'),
            ],
            snippet: { language: 'bash', code: 'sudo certbot renew --dry-run' },
        },
    },
    mixed_content: {
        generic: {
            steps: [
                t(
                    'Open the example address in the finding and change its http:// to https:// in your page, template or database.',
                    'Otevřete ukázkovou adresu z nálezu a ve stránce, šabloně nebo databázi změňte její http:// na https://.',
                ),
                t('If the other site does not offer https, host the file yourself or drop it.', 'Pokud druhý web https nenabízí, hostujte soubor sami, nebo ho odeberte.'),
                t(
                    'As a stop-gap, you can ask browsers to upgrade such requests with the header below.',
                    'Jako dočasné řešení můžete prohlížeče hlavičkou níže požádat, aby takové požadavky převedly na https.',
                ),
            ],
            snippet: { language: 'http', code: 'Content-Security-Policy: upgrade-insecure-requests' },
        },
        platforms: {
            wordpress: {
                steps: [
                    t('Open Settings, then General, and make sure both addresses start with https://.', 'Otevřete Nastavení a pak Obecné a ověřte, že obě adresy začínají https://.'),
                    t(
                        'Old posts may still hold http:// addresses. A search-and-replace plugin can change them in the database.',
                        'Ve starých příspěvcích mohou zůstat adresy s http://. Plugin pro hledání a nahrazování je v databázi změní.',
                    ),
                    t('Make a backup first.', 'Nejdřív si udělejte zálohu.'),
                ],
            },
        },
    },
    render_blocking: {
        generic: {
            steps: [
                t(
                    'Add defer to scripts in the <head> that the first view does not need. They then load without holding back the page.',
                    'Skriptům v <head>, které první zobrazení nepotřebuje, přidejte defer. Pak se načtou, aniž by zdržovaly stránku.',
                ),
                t('Use async for independent scripts such as analytics.', 'Pro nezávislé skripty, například analytiku, použijte async.'),
                t('Load stylesheets that are only used for printing with media="print".', 'Styly, které slouží jen pro tisk, načítejte s media="print".'),
            ],
            snippet: { language: 'html', code: '<script src="/app.js" defer></script>' },
            risk: t('Scripts that depend on each other must keep their order. defer keeps it, async does not.', 'Skripty, které na sobě závisí, musí zachovat pořadí. defer ho zachová, async ne.'),
        },
    },
    image_formats: {
        generic: {
            steps: [
                t(
                    'Convert photos to WebP or AVIF, which are much smaller than JPEG and PNG at the same quality.',
                    'Převeďte fotky do WebP nebo AVIF, které jsou při stejné kvalitě mnohem menší než JPEG a PNG.',
                ),
                t('Keep a JPEG fallback with the <picture> element for old browsers.', 'Pro starší prohlížeče ponechte záložní JPEG v elementu <picture>.'),
            ],
            snippet: {
                language: 'html',
                code: '<picture>\n  <source srcset="beans.avif" type="image/avif">\n  <source srcset="beans.webp" type="image/webp">\n  <img src="beans.jpg" width="800" height="600" alt="Coffee beans">\n</picture>',
            },
        },
    },
    lazy_loading: {
        generic: {
            steps: [
                t('Add loading="lazy" to images that are below the first screen.', 'Obrázkům, které jsou až pod první obrazovkou, přidejte loading="lazy".'),
                t('Leave it off for the first images at the top: lazy loading would delay them.', 'U prvních obrázků nahoře ho vynechte: odložené načítání by je zpozdilo.'),
            ],
            snippet: { language: 'html', code: '<img src="beans.jpg" width="800" height="600" alt="Coffee beans" loading="lazy">' },
        },
        platforms: {
            nextjs: {
                steps: [
                    t(
                        'next/image lazy-loads by default, so a plain <img> without loading="lazy" is the thing to look for.',
                        'next/image načítá obrázky odloženě už ve výchozím nastavení, takže hledejte obyčejné <img> bez loading="lazy".',
                    ),
                ],
            },
        },
    },
    link_headers: {
        generic: {
            steps: [
                t(
                    'Add a Link header to the response of your home page that points to the API catalog, service description or documentation your site offers.',
                    'Do odpovědi domovské stránky přidejte hlavičku Link, která odkazuje na katalog API, popis služby nebo dokumentaci, kterou váš web nabízí.',
                ),
                t(
                    'Use the relation that fits: api-catalog, service-desc (a machine-readable description such as an OpenAPI file) or service-doc (the human documentation).',
                    'Použijte vhodný vztah (rel): api-catalog, service-desc (strojově čitelný popis, například soubor OpenAPI) nebo service-doc (dokumentace pro lidi).',
                ),
                SCAN_AGAIN,
            ],
            snippet: { language: 'http', code: 'Link: </.well-known/api-catalog>; rel="api-catalog"' },
            risk: t(
                'Publish only what exists. A Link header that points to a missing file is worse than none.',
                'Zveřejněte jen to, co existuje. Hlavička Link, která vede na chybějící soubor, je horší než žádná.',
            ),
        },
    },
    api_catalog: {
        generic: {
            steps: [
                t(
                    'Publish a JSON file at /.well-known/api-catalog that lists your APIs, in the linkset format of RFC 9727.',
                    'Zveřejněte na /.well-known/api-catalog soubor JSON se seznamem vašich API ve formátu linkset podle RFC 9727.',
                ),
                t('Serve it with the content type application/linkset+json.', 'Posílejte ho s typem obsahu application/linkset+json.'),
                t('Make each href lead to the API or to its description.', 'Zajistěte, aby každé href vedlo na API nebo na jeho popis.'),
            ],
            snippet: {
                language: 'json',
                code: '{\n  "linkset": [\n    {\n      "anchor": "https://example.com/.well-known/api-catalog",\n      "item": [{ "href": "https://example.com/api" }]\n    }\n  ]\n}',
            },
            risk: t(
                'Only list APIs that agents are meant to use. An empty or wrong catalog is a warning, not a bonus.',
                'Uveďte jen API, která mají agenti používat. Prázdný nebo chybný katalog je varování, ne bonus.',
            ),
        },
    },
    oauth_resource: {
        generic: {
            steps: [
                t(
                    'If your API is protected with OAuth, publish a document at /.well-known/oauth-protected-resource that names it and the authorization servers that can issue tokens for it.',
                    'Pokud je vaše API chráněné přes OAuth, zveřejněte na /.well-known/oauth-protected-resource dokument, který ho pojmenuje a uvede autorizační servery, jež pro něj mohou vydávat tokeny.',
                ),
                t('resource is required. authorization_servers lists the issuers.', 'resource je povinné. authorization_servers uvádí vydavatele tokenů.'),
            ],
            snippet: { language: 'json', code: '{\n  "resource": "https://example.com/api",\n  "authorization_servers": ["https://auth.example.com"]\n}' },
        },
    },
};

export type GuideTab = { id: 'generic' | Technology; guide: Guide };

const resolve = (source: GuideSource, locale: Locale): Guide => ({
    steps: source.steps.map((step) => step[locale]),
    ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
    ...(source.risk === undefined ? {} : { risk: source.risk[locale] }),
});

// Detected platforms first (in the order found), then the guide for any site, then the other platforms.
const rank = (tab: GuideTab, detected: readonly Technology[]): number => {
    if (tab.id === 'generic') return detected.length + 0.5;
    const index = detected.indexOf(tab.id);
    return index === -1 ? detected.length + 1 : index;
};

/** The guides for a check in one language, the detected platform's first (its tab is the one preselected). Empty when the check has no guide. */
export const guideTabs = (checkId: string, detected: readonly Technology[], locale: Locale): GuideTab[] => {
    const entry = fixGuides[checkId];
    if (entry === undefined) return [];
    const platforms = Object.entries(entry.platforms ?? {}).flatMap(([id, guide]): GuideTab[] => (guide === undefined ? [] : [{ id: id as Technology, guide: resolve(guide, locale) }]));
    const generic: GuideTab = { id: 'generic', guide: resolve(entry.generic, locale) };
    return [generic, ...platforms].sort((a, b) => rank(a, detected) - rank(b, detected));
};
