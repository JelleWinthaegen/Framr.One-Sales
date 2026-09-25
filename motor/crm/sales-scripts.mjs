/*
  Jarvis - sales-scripts: de gesprekshulp per stap van het verkoopproces van Framr.One, als data.

  Jelle wil (15-09-2026) het telefoongesprek en de demo inhoudelijk scheiden: het eerste
  gesprek gaat over de juiste persoon, relevantie, de situatie kort, een eerste behoefte of
  bezwaar en een passende volgende stap; de verdiepende vragen horen bij de demo, die
  voortbouwt op wat al bekend is. Per stap een eigen script, met een versie die op het
  contactmoment wordt vastgelegd (interactions.script_ref), zodat een oude registratie zijn
  context houdt als het script verandert.

  Het eerste gesprek is sinds 17-09-2026 het belscript van Myron (OAKLYN BELscript, aangeleverd
  door Jelle als Word-document; de tekst staat letterlijk in het brein als wiki
  framr-belscript-myron op framr-one). Het is een vertakt script: een korte opening, dan per
  reactie van de gesprekspartner wat je zegt (reacties), verdiepende vragen per thema als hij
  praat (vragen, elk met het veld dat ze vullen), samenvatten, de overgang naar de demo, en wat
  je doet bij definitief geen interesse. De vorige versie (v1-voorlopig) blijft bewaard onder
  VORIGE_SCRIPTS, zodat oude registraties met die script_ref hun context houden.

  De bedragen in het script (zes euro per vierkante meter, zeshonderd euro op honderd meter)
  zijn de publieke claims van de vloerenpagina; er staan geen inkoopprijzen of condities in.
  Het script noemt Oaklyn als afzender en als naam van het systeem; dat is de keuze van Myron
  en Jelle, hier niet aangepast.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

export const STAPPEN = ['eerste_contact', 'opvolging_na_informatie', 'demo', 'opvolging_na_demo', 'onboarding', 'service', 'heractivatie', 'reactie'];

export const SCRIPTS = {
  eerste_contact: {
    stap: 'eerste_contact',
    versie: 'v2-myron',
    bron: 'OAKLYN BELscript van Myron, aangeleverd door Jelle op 17-09-2026 (wiki framr-belscript-myron)',
    nodig: null,
    doel: 'Een kwartiertje digitaal laten zien wat het systeem doet, op zijn eigen klus. Elk gesprek eindigt in een demo-afspraak met dag en tijd, of in een reden waarom niet.',
    opnamezin: 'Wil je opnemen, vraag het direct na de begroeting: ik neem het gesprek even op voor mijn eigen aantekeningen, vind je dat goed? Zonder ja geen opname. Dit staat niet in het script van Myron; het is de regel van het systeem.',
    opening: [
      'Hoi [naam], je spreekt met Myron van Oaklyn. We zagen je laatst voorbijkomen op internet en zagen dat je goed werk levert.',
      'Wij hebben iets ontwikkeld waarmee je als vloerenlegger ongeveer 6 euro per vierkante meter extra kunt overhouden op je materiaal. Daarnaast kun je er ook een stuk sneller mee inmeten, calculeren en offreren.',
      'Klinkt dat als iets wat voor jou interessant zou kunnen zijn?',
      'STOP. Niet verder praten. Laat hem reageren.',
    ],
    /* Wat je zegt bij elke reactie van de gesprekspartner, in de volgorde van het script van
       Myron. herken zijn de zinnen waaraan je de reactie herkent; zeg is wat je dan zegt; daarna
       is waar het naartoe gaat. bezwaarCategorie koppelt de reactie aan de bezwarenbibliotheek,
       zodat het bezwaarblok de reactie uit het script kan voorstellen. */
    reacties: [
      { op: 'Hij reageert positief', herken: ['Ja, klinkt wel interessant.'], bezwaarCategorie: null, uitkomst: 'demo_aangeboden',
        zeg: ['Mooi. Het makkelijkste is dat ik het je even digitaal laat zien. Dan zie je meteen hoe het werkt en wat het voor jou kan opleveren. Dat duurt maar een kwartiertje.', 'Wanneer zou dat voor jou uitkomen?'],
        daarna: 'Als hij een dag noemt: Top. Past [tijdstip] voor jou? Dan: Perfect. Dan zet ik hem erin. Ik stuur je zo even een WhatsApp met de bevestiging en dan spreken we elkaar [dag] om [tijd].' },
      { op: 'Hij twijfelt', herken: ['Ja, weet ik niet.', 'Wat is het precies?', 'Ik heb eigenlijk al iets.'], bezwaarCategorie: 'vertrouwen', uitkomst: null,
        zeg: ['Begrijpelijk. We hebben hiervoor een volledig nieuwe tool ontwikkeld. In deze vorm hebben we hem nog nergens anders op de markt gezien.', 'Voordat we hem breder uitrollen, willen we juist feedback verzamelen van goede vloerenleggers zoals jij. Daarom zijn we ook bij jou terechtgekomen.', 'Kijk, je hoeft nu nergens ja tegen te zeggen. Ik wil hem gewoon een kwartiertje digitaal aan je laten zien en horen wat jij ervan vindt. Zou je daar wel voor openstaan?'],
        daarna: 'Naar de demo-afspraak.' },
      { op: 'Hij wil eerst weten wat het systeem doet', herken: ['Wat doet het dan?', 'Leg eens uit.'], bezwaarCategorie: null, uitkomst: null,
        zeg: ['Eigenlijk begint het al bij je inmeting. Je voert je maten een keer in en van daaruit worden de benodigde materialen voor je berekend. Dus bijvoorbeeld je vloer, egaline, primer, lijm en plinten. Je kunt je werkzaamheden toevoegen en vervolgens direct een complete professionele offerte maken.', 'Het idee is eigenlijk dat je veel minder dubbel hoeft in te voeren en s avonds niet opnieuw alles hoeft uit te rekenen.', 'Niet eindeloos verder uitleggen: maar als ik het allemaal telefonisch ga uitleggen, klinkt het ingewikkelder dan het is. Als ik het je even laat zien, snap je binnen een paar minuten precies wat ik bedoel.'],
        daarna: 'Naar de demo-afspraak.' },
      { op: 'Ik heb al een systeem, ik werk met Excel', herken: ['Ik heb al een systeem.', 'Ik werk met Excel.'], bezwaarCategorie: 'software', uitkomst: null,
        zeg: ['Ja, logisch. En als dat goed werkt, hoef je dat van mij ook niet zomaar weg te gooien.', 'Mag ik vragen: hoe gaat dat bij jullie nu? Vanaf het moment dat je hebt ingemeten tot het moment dat de klant de offerte ontvangt?', 'Laat hem vertellen. Vervolgvragen indien nodig: moet je de maten daarna nog ergens opnieuw invoeren? Hoe bereken je de materialen? Hoe lang ben je gemiddeld met zo een offerte bezig? Wanneer doe je dat meestal, overdag of toch vaak s avonds? Hoe snel krijgt een klant na de inmeting normaal zijn offerte?'],
        daarna: 'Koppel Oaklyn aan zijn antwoord, dan naar de demo-afspraak.' },
      { op: 'Ik ben tevreden met mijn leverancier', herken: ['Ik ben tevreden met mijn leverancier.', 'Ik koop al jaren bij dezelfde.'], bezwaarCategorie: 'huidige leverancier', uitkomst: null,
        zeg: ['Dat snap ik helemaal. Je hoeft ook niet ineens je huidige leverancier aan de kant te zetten.', 'Het interessante is vooral dat je bij ons kunt vergelijken wat je op een project overhoudt. Als jij bijvoorbeeld 100 m2 legt en je houdt via ons gemiddeld 6 euro per vierkante meter extra over, dan hebben we het over ongeveer 600 euro extra marge op hetzelfde project. Zonder dat jij daar een meter extra voor hoeft te leggen.', 'Dat kan ik je tijdens die demo gewoon met een echte klus laten zien.'],
        daarna: 'Naar de demo-afspraak.' },
      { op: 'Tool niet interessant, maar goedkoper inkopen misschien wel', herken: ['Die tool hoef ik niet.', 'Ik wil alleen goedkoper inkopen.'], bezwaarCategorie: 'software', uitkomst: null,
        zeg: ['Duidelijk. Los van de tool hebben we ook een groothandel voor vloeren. Daarmee kunnen we vloerenleggers structureel voordeliger laten inkopen, waardoor je ongeveer 6 euro per vierkante meter extra kunt overhouden.', 'Ik kan tijdens hetzelfde kwartiertje ook gewoon even laten zien wat dat bij jouw projecten zou betekenen.'],
        daarna: 'Naar de demo-afspraak.' },
      { op: 'Ik heb geen tijd', herken: ['Ik heb geen tijd.', 'Druk, druk.'], bezwaarCategorie: 'geen tijd', uitkomst: 'geen_tijd',
        zeg: ['Snap ik. En eerlijk gezegd is dat juist een van de redenen waarom we dit hebben gemaakt. Het hele idee is dat je minder tijd kwijt bent aan rekenen, offertes en administratie.', 'Ik hoef je nu ook niks uit te leggen. Geef me gewoon een kwartiertje op een moment dat het jou wel uitkomt. Daarna kun je zelf bepalen of het je tijd gaat besparen.', 'Wanneer zit je meestal wat rustiger? Eind van de middag of s avonds?'],
        daarna: 'Een moment prikken; anders de uitkomst geen tijd en de reeks bepaalt wanneer we opnieuw bellen.' },
      { op: 'Stuur maar wat informatie', herken: ['Stuur maar wat informatie.', 'Mail het maar.'], bezwaarCategorie: 'eerst_stalen_of_ervaringen', uitkomst: 'eerst_informatie',
        zeg: ['Ja, natuurlijk, dat kan ik doen. Alleen merk ik dat het op papier veel ingewikkelder klinkt dan wanneer je het gewoon even ziet.', 'Ik stuur je sowieso wat informatie. Zullen we dan meteen een kwartiertje prikken? Als je na het bekijken denkt dat het niks voor je is, is dat natuurlijk ook prima.'],
        daarna: 'Demo prikken als het lukt; altijd de WhatsApp met de pagina versturen.' },
      { op: 'Definitief geen interesse', herken: ['Nee, geen interesse.', 'Laat maar.'], bezwaarCategorie: 'geen interesse', uitkomst: 'geen_match',
        zeg: ['Niet blijven doorduwen.', 'Geen probleem. Mag ik nog vragen waar het vooral aan ligt? Dan weet ik of het op dit moment gewoon niet bij je past, of dat ik het niet duidelijk genoeg heb uitgelegd.', 'Luister. De informatie die hij nu geeft is waardevol voor toekomstige gesprekken.'],
        daarna: 'De reden letterlijk vastleggen als bezwaar; kies nu geen behoefte (met een datum) of geen match.' },
    ],
    /* Als je meer wilt onderzoeken: als iemand wel praat, hoef je niet meteen naar de demo. Per
       thema de vragen van Myron, elk met het discovery-veld dat het antwoord vult. */
    vragen: [
      { thema: 'werkwijze', vraag: 'Hoe verloopt bij jullie normaal een project vanaf de inmeting?', vult: ['hoe_inmeten'], door: 'Waar noteer je alle maten?', veld: 'hoe_inmeten' },
      { thema: 'werkwijze', vraag: 'Hoe bereken je daarna welke materialen je nodig hebt?', vult: ['hoe_materialen_berekend'], door: 'Gebruik je daar een systeem voor of verschillende programma s?', veld: 'hoe_materialen_berekend' },
      { thema: 'werkwijze', vraag: 'Gebruik je daar een systeem voor of verschillende programma s?', vult: ['huidige_software'], door: 'Wat mis je erin?', veld: 'huidige_software' },
      { thema: 'offertes', vraag: 'Hoe lang ben je gemiddeld bezig met een offerte?', vult: ['tijd_per_offerte'], door: 'Wanneer doe je dat meestal, overdag of s avonds?', veld: 'tijd_per_offerte' },
      { thema: 'offertes', vraag: 'Hoe snel na een inmeting krijgt de klant hem meestal?', vult: ['doorlooptijd_offerte'], door: 'Komt het weleens voor dat offertes een paar dagen blijven liggen?', veld: 'doorlooptijd_offerte' },
      { thema: 'offertes', vraag: 'Komt het weleens voor dat offertes een paar dagen blijven liggen?', vult: ['offertes_blijven_liggen'], door: 'Waardoor komt dat dan?', veld: 'offertes_blijven_liggen' },
      { thema: 'conversie', vraag: 'Hoeveel van de offertes die je maakt worden uiteindelijk ongeveer een opdracht?', vult: ['offerte_conversie'], door: 'Volg je offertes daarna ook nog actief op?', veld: 'offerte_conversie' },
      { thema: 'conversie', vraag: 'Volg je offertes daarna ook nog actief op?', vult: ['offertes_opvolgen'], door: 'Hoe dan?', veld: 'offertes_opvolgen' },
      { thema: 'materiaal', vraag: 'Koopt de klant de vloer meestal bij jou of ergens anders?', vult: ['koopt_zelf_in'], door: 'Pak je nu zelf ook marge op het materiaal?', veld: 'koopt_zelf_in' },
      { thema: 'materiaal', vraag: 'Pak je nu zelf ook marge op het materiaal?', vult: ['marge_op_materiaal'], door: 'Hoeveel ongeveer?', veld: 'marge_op_materiaal' },
      { thema: 'materiaal', vraag: 'Hoeveel vierkante meter leg je ongeveer in een gemiddelde maand?', vult: ['m2_per_maand'], door: 'Seizoen of het hele jaar?', veld: 'm2_per_maand' },
      { thema: 'levering', vraag: 'Waar bestel je je materialen nu?', vult: ['huidige_vloerleverancier'], door: 'Wat vind je daar goed aan?', veld: 'huidige_vloerleverancier' },
      { thema: 'levering', vraag: 'Haal je die zelf op of laat je alles bezorgen?', vult: ['ophalen_of_bezorgen'], door: 'Wat kost je dat aan tijd?', veld: 'ophalen_of_bezorgen' },
      { thema: 'levering', vraag: 'Komt het weleens voor dat je verschillende materialen bij verschillende leveranciers moet halen?', vult: ['meerdere_leveranciers'], door: 'Hoe vaak?', veld: 'meerdere_leveranciers' },
    ],
    bijAarzeling: 'Kijk, je hoeft nu nergens ja tegen te zeggen. Ik wil hem gewoon een kwartiertje digitaal aan je laten zien en horen wat jij ervan vindt. Zou je daar wel voor openstaan?',
    samenvatten: [
      'Dit is belangrijk. Als ik het goed begrijp, meten jullie nu in via [methode]. Daarna ben je ongeveer [tijd] bezig met het uitrekenen van de materialen en de offerte. De klant krijgt die meestal na [tijd] en qua materiaal verdienen jullie daar nu wel of niet aan. Klopt dat een beetje?',
      'Wacht op bevestiging.',
      'Dan denk ik dat Oaklyn voor jou vooral interessant kan zijn omdat je dat proces een stuk makkelijker kunt maken, je veel sneller een professionele offerte naar je klant kunt sturen en extra marge op je materiaal kunt pakken.',
    ],
    afsluiting: [
      'De beste overgang naar de demo: heb je toevallig een recente inmeting of een klus die binnenkort aankomt?',
      'Als hij die heeft: perfect. Dan moeten we niet met een fictief voorbeeld gaan werken. Dan pakken we gewoon jouw eigen klus erbij en verwerken we die samen in Oaklyn. Dan kun je direct zien hoeveel tijd het scheelt, wat de klant betaalt en wat jij eraan overhoudt.',
      'Geef me daar een kwartiertje voor. Wanneer komt het jou uit?',
      'Bij een dag: past [tijdstip] voor jou? Dan zet ik hem erin en stuur ik je zo een WhatsApp met de bevestiging.',
    ],
    naHetGesprek: [
      'Uitkomst kiezen: de fase en de volgende taak volgen vanzelf. Een demo krijgt datum en tijd.',
      'Samenvatting in vier onderdelen: wie gesproken en in welke context, hoe hij nu werkt, wat de behoefte, kans of belemmering is, wat concreet is afgesproken.',
      'De drie vragen: wat wil hij wel, wat wil hij niet, en waarom.',
      'Elk bezwaar apart, letterlijk, met je reactie en of die werkte; bij definitief geen interesse de reden die hij noemde.',
      'De klus die hij noemde als kans: naam, m2, datum.',
      'Extra dingen die je hoorde: een vraag, een inzicht, een productwens, persoonlijke context, een afspraak.',
      'De WhatsApp met de bevestiging of de informatie versturen en als verstuurd bevestigen, met de reactietermijn.',
    ],
  },
  opvolging_na_informatie: {
    stap: 'opvolging_na_informatie',
    versie: 'v1-voorlopig',
    bron: 'afgeleid uit het gesprekssysteem 02-08-2026',
    nodig: null,
    doel: 'Na de landingspagina of de demo-video: horen wat hij ervan vond, een vraag beantwoorden, en de demo of het proefproject afspreken.',
    opening: [
      'Je spreekt met [naam] van Framr.One, we spraken elkaar op [datum]. Ik had je de pagina gestuurd; heb je even kunnen kijken?',
      'Als hij niet gekeken heeft: geen probleem, zal ik in twee zinnen zeggen wat erop staat?',
    ],
    vragen: [
      { vraag: 'Wat viel je op, of wat riep vragen op?', vult: ['reactie_op_informatie'], door: 'Alleen luisteren.', veld: 'reactie_op_informatie' },
      { vraag: 'Zie je een project waar dit bij zou passen?', vult: ['opportunities'], door: 'Wanneer speelt dat?', veld: 'kans' },
      { vraag: 'Zullen we dat project samen doorrekenen in een korte demo?', vult: ['interesse_voor_demo'], door: 'Online of telefonisch, en wanneer past het?', veld: 'interesse_voor_demo' },
    ],
    bijAarzeling: 'Wat zou je moeten zien om te weten of dit iets voor jou is? Dat is de agenda van de demo.',
    afsluiting: [
      'Een datum en tijd voor de demo, of een concreet volgend moment.',
      'Geen reactie op de pagina en geen tijd: de opvolgreeks bepaalt wanneer we opnieuw bellen.',
    ],
    naHetGesprek: ['Uitkomst kiezen.', 'De demo plannen met datum en tijd, of de volgende datum vastleggen.', 'Bezwaren apart vastleggen.'],
  },
  demo: {
    stap: 'demo',
    versie: 'v1-voorlopig',
    bron: 'crm-veldcatalogus 04-08-2026 (de verdiepende vragen) en brainstorm onderdeel 13 en 14 (15-09-2026)',
    nodig: null,
    doel: 'Waarde laten ervaren op zijn eigen project, en verdiepen wat we nog niet weten: leverancier, tevredenheid, inmeten en offertes, software, inkoop en marge, projectvolume, het volgende project, besliscriteria.',
    opening: [
      'Wat we al weten staat in de briefing: niet opnieuw vragen, wel bevestigen.',
      'Het doel van vandaag: een echt project van hem samen doorrekenen, van inmeting tot offerte en bestelling.',
    ],
    vragen: [
      { vraag: 'Waar koop je nu je vloeren, en hoe tevreden ben je daarover?', vult: ['huidige_vloerleverancier', 'tevredenheid_leverancier'], door: 'Wat zou je verbeteren?', veld: 'grootste_probleem_leverancier' },
      { vraag: 'Hoe gaat inmeten, calculeren en offreren nu bij jou?', vult: ['hoe_inmeten', 'hoe_offertes', 'tijd_per_offerte'], door: 'Hoe lang duurt een offerte, en factureren?', veld: 'hoe_offertes' },
      { vraag: 'Welke software gebruik je daarvoor, en voor de boekhouding?', vult: ['huidige_software'], door: 'Wat mis je erin?', veld: 'huidige_software' },
      { vraag: 'Koop je zelf in, of levert de klant het materiaal? Pak je marge op materiaal?', vult: ['koopt_zelf_in', 'marge_op_materiaal'], door: 'Reken je dat een op een door?', veld: 'marge_op_materiaal' },
      { vraag: 'Hoeveel projecten en m2 doe je per maand?', vult: ['projecten_per_maand', 'm2_per_maand'], door: 'Seizoen of het hele jaar?', veld: 'm2_per_maand' },
      { vraag: 'Wat is je volgende concrete project?', vult: ['opportunities'], door: 'Zullen we die nu doorrekenen?', veld: 'kans' },
      { vraag: 'Wat zou je moeten zien of weten om hiermee te starten, en wat houdt je tegen?', vult: ['besliscriteria', 'demo_reden_niet_starten'], door: 'Wie beslist er verder mee?', veld: 'besliscriteria' },
    ],
    bijAarzeling: 'Wat moet er eerst opgelost zijn voor je een project via Framr.One doet?',
    afsluiting: [
      'Een concrete volgende stap met eigenaar en datum: account aanmaken, eerste project begeleiden, of een nieuw moment.',
      'Samenvatten wat is afgesproken en wat wij gaan doen.',
    ],
    naHetGesprek: ['Samenvatting: wat is getoond, wat begreep hij, wat was relevant, het aha-moment.', 'Meerdere bezwaren en vragen apart.', 'Wat moet eerst opgelost worden.', 'De volgende stap met eigenaar en datum.', 'Optioneel: de scores per onderdeel.'],
  },
  opvolging_na_demo: {
    stap: 'opvolging_na_demo',
    versie: 'v1-voorlopig',
    bron: 'afgeleid uit de gebruikersflow (levensfase 5 en 6)',
    nodig: null,
    doel: 'De demo-afspraken nakomen, de belangrijkste bezwaren wegnemen, en het account of het eerste project concreet maken.',
    opening: [
      'Je spreekt met [naam]; bedankt voor de demo op [datum]. We hadden afgesproken dat [afspraak].',
      'Hoe kijk je er nu op terug, nu je er een nacht over hebt geslapen?',
    ],
    vragen: [
      { vraag: 'Wat is er nog nodig om te starten?', vult: ['demo_reden_niet_starten', 'besliscriteria'], door: 'Wie beslist er mee?', veld: 'demo_reden_niet_starten' },
      { vraag: 'Is het project waar we het over hadden nog actueel?', vult: ['opportunities'], door: 'Wanneer wordt er ingemeten?', veld: 'kans' },
    ],
    bijAarzeling: 'Zullen we het eerste project samen doen, dan zie je het aan je eigen cijfers?',
    afsluiting: ['Account aanmaken en het eerste project inplannen, of een nieuwe datum.'],
    naHetGesprek: ['Uitkomst kiezen.', 'Bezwaren apart.', 'De volgende stap met datum.'],
  },
  onboarding: {
    stap: 'onboarding',
    versie: 'v1-voorlopig',
    bron: 'partneractivatie (brainstorm onderdeel 18)',
    nodig: null,
    doel: 'Het account ingericht, de eerste klant en het eerste project in het portaal, de eerste bestelling begeleid.',
    opening: ['Samen inloggen; de mijlpalen van de partneractivatie als checklist.'],
    vragen: [
      { vraag: 'Staat je bedrijfsprofiel, logo en bankrekening erin?', vult: ['onboarding_profiel'], door: 'Zullen we dat nu samen doen?', veld: 'onboarding_profiel' },
      { vraag: 'Welk project doen we als eerste?', vult: ['opportunities'], door: 'Wanneer wordt ingemeten?', veld: 'kans' },
    ],
    bijAarzeling: 'Wat houdt je tegen om het eerste project erin te zetten?',
    afsluiting: ['De volgende mijlpaal met datum.'],
    naHetGesprek: ['Wat is ingericht, wat blokkeert, de volgende stap.'],
  },
  service: {
    stap: 'service',
    versie: 'v1',
    bron: 'aanvulling van Jelle 15-09-2026, onderdeel 3 (service als onderdeel van de klantrelatie)',
    nodig: null,
    doel: 'Na een bevestigde levering, bij een probleem of om de relatie te onderhouden: horen hoe het ging, een probleem aan een verantwoordelijke en een datum hangen, en de context bewaren voor een volgend gesprek. Een servicegesprek hoeft niets te verkopen.',
    voorbereiding: [
      'De bestelling erbij: nummer, wat er geleverd is, wanneer bevestigd.',
      'De laatste gesprekken en open taken van deze klant: is een collega er net geweest, dan eerst afstemmen.',
      'Eerdere problemen en afspraken.',
    ],
    opening: [
      'Je spreekt met [naam] van Framr.One. Jullie bestelling [nummer] is geleverd; ik bel even om te horen hoe het is gegaan.',
      'Komt het nu uit, of bel ik beter op een ander moment?',
    ],
    vragen: [
      { thema: 'levering', vraag: 'Is alles goed aangekomen, compleet en onbeschadigd?', vult: ['levering_goed'], door: 'Klopte de leverdatum en het tijdstip?', veld: 'levering_goed' },
      { thema: 'project', vraag: 'Hoe is het project verlopen?', vult: ['project_verlopen'], door: 'Wat ging makkelijker of moeilijker dan gedacht?', veld: 'project_verlopen' },
      { thema: 'project', vraag: 'Was de klant tevreden?', vult: ['klant_tevreden'], door: 'Wat zei hij precies?', veld: 'klant_tevreden' },
      { thema: 'problemen', vraag: 'Waren er problemen met het product, de levering of de verwerking?', vult: ['problemen_gehad'], door: 'Wat precies, en is het al opgelost?', veld: 'problemen_gehad' },
      { thema: 'verbeteren', vraag: 'Wat kunnen wij beter doen?', vult: ['verbeterpunt'], door: 'Wat zou het voor jou makkelijker maken?', veld: 'verbeterpunt' },
      { thema: 'vervolg', vraag: 'Is er een volgend project aan de horizon?', vult: ['opportunities'], door: 'Wanneer wordt er ingemeten?', veld: 'kans' },
      { thema: 'vervolg', vraag: 'Is er iets dat ik moet onthouden voor de volgende keer dat we elkaar spreken?', vult: ['context_volgend_gesprek'], door: 'Persoonlijk of zakelijk, alles helpt.', veld: 'context_volgend_gesprek' },
    ],
    bijAarzeling: 'Geen verkoopgesprek: als hij druk is, een moment prikken of alleen de eerste vraag stellen. Een opgelost probleem of een goed gesprek is de uitkomst.',
    afsluiting: [
      'Elk probleem herhalen met wie het oppakt en wanneer hij ervan hoort.',
      'Bedanken; als er een volgend project is, de datum noteren en dan terugbellen.',
    ],
    stappen: [
      'Uitkomst kiezen: tevreden, probleem gemeld, volgend project besproken, of niet bereikt.',
      'Elk probleem apart: wat, soort (product, levering, verwerking), wie pakt het op, wanneer is het vervolg.',
      'De antwoorden op de vragen vastleggen, in zijn woorden.',
      'Persoonlijke of zakelijke context als extra vastleggen.',
    ],
    vastTeLeggen: ['uitkomst', 'problemen met verantwoordelijke en vervolgdatum', 'levering_goed', 'klant_tevreden', 'verbeterpunt', 'volgend project als kans'],
    uitkomsten: [
      { uitkomst: 'tevreden', vervolg: 'over zestig dagen de relatie onderhouden' },
      { uitkomst: 'probleem_gemeld', vervolg: 'per probleem een taak bij de verantwoordelijke op de vervolgdatum' },
      { uitkomst: 'volgend_project_besproken', vervolg: 'bellen rond de projectdatum' },
      { uitkomst: 'niet_opgenomen', vervolg: 'morgen opnieuw' },
    ],
    naHetGesprek: ['Uitkomst kiezen.', 'Problemen apart, elk met verantwoordelijke en vervolgdatum.', 'De antwoorden vastleggen.', 'Extra dingen die je hoorde.'],
  },
  heractivatie: {
    stap: 'heractivatie',
    versie: 'v1-voorlopig',
    bron: 'afgeleid uit de partnergezondheid (slapend, aandacht nodig)',
    nodig: null,
    doel: 'Een stille partner of een lead die eerder nee zei opnieuw in beweging krijgen: wat is er veranderd, wat speelt er nu.',
    opening: ['Je spreekt met [naam] van Framr.One; we hebben [periode] niets van elkaar gehoord. Hoe gaat het met de zaak?'],
    vragen: [
      { vraag: 'Wat is er sinds de vorige keer veranderd in hoe je werkt of inkoopt?', vult: ['grootste_pijnpunt'], door: 'Speelt dat nu?', veld: 'grootste_pijnpunt' },
      { vraag: 'Is er een project aan de horizon?', vult: ['opportunities'], door: 'Wanneer?', veld: 'kans' },
    ],
    bijAarzeling: 'Wat zou het voor jou de moeite waard maken om het opnieuw te proberen?',
    afsluiting: ['Een proefproject of een datum; anders bewust parkeren tot een datum.'],
    naHetGesprek: ['Uitkomst kiezen; bij nu geen behoefte een pauze tot een datum.'],
  },
};

/*
  De SOP-delen per script (aanvulling van Jelle, onderdeel 5): doel, voorbereiding, stappen,
  wat vast te leggen, en de mogelijke uitkomsten met hun vervolg. De begeleide weergave toont
  ze bij de taak; de compacte weergave laat ze weg en houdt een knop naar de volledige werkwijze.
  De stap service heeft ze al in het script zelf.
*/
const SOP_DELEN = {
  eerste_contact: {
    voorbereiding: ['De briefing lezen: wat weten we al (website, reviews, specialisme, eerdere contacten).', 'Nummer en contactpersoon checken; een eenmanszaak alleen met opt-in.', 'Het script open: de opening en wat je zegt bij elke reactie.'],
    stappen: ['De opening in twintig seconden, dan stil.', 'Zijn reactie herkennen en het antwoord uit het script geven.', 'Als hij praat: de onderzoeksvragen per thema, niet allemaal.', 'Samenvatten wat hij vertelde en laten bevestigen.', 'De overgang naar de demo: zijn eigen klus, een kwartiertje, dag en tijd.', 'Direct daarna de WhatsApp met de bevestiging of de informatie.'],
    vastTeLeggen: ['de uitkomst', 'de drie vragen: wil wel, wil niet, waarom', 'elk bezwaar apart, letterlijk, met je reactie', 'zijn klus als kans', 'de demo met dag en tijd, of de volgende datum'],
    uitkomsten: [
      { uitkomst: 'demo_ingepland', vervolg: 'de afspraak met tijd in de agenda; de bevestiging per WhatsApp' },
      { uitkomst: 'eerst_informatie', vervolg: 'de WhatsApp met de pagina; nabellen volgens de reeks als er geen reactie komt' },
      { uitkomst: 'geen_tijd', vervolg: 'een nieuw moment; anders bepaalt de reeks geen tijd wanneer we opnieuw bellen' },
      { uitkomst: 'nu_geen_behoefte', vervolg: 'pauze tot een datum, dan opnieuw peilen' },
      { uitkomst: 'geen_match', vervolg: 'verloren, met de reden die hij noemde' },
      { uitkomst: 'niet_opgenomen', vervolg: 'de reeks niet opgenomen: morgen opnieuw' },
    ],
  },
  opvolging_na_informatie: {
    voorbereiding: ['Wat is er gestuurd en wanneer; kwam er een reactie.', 'Wat hij in het eerste gesprek wilde en niet wilde.'],
    stappen: ['Kort: heb je kunnen kijken.', 'Wat viel op, wat riep vragen op.', 'Een project waar dit bij past.', 'De demo afspreken met dag en tijd.'],
    vastTeLeggen: ['de uitkomst', 'zijn reactie op de informatie', 'de demo met dag en tijd of de volgende datum'],
    uitkomsten: [{ uitkomst: 'demo_ingepland', vervolg: 'de afspraak met tijd' }, { uitkomst: 'mogelijk_interesse', vervolg: 'opvolgen na drie dagen' }, { uitkomst: 'nu_geen_behoefte', vervolg: 'pauze tot een datum' }],
  },
  demo: {
    voorbereiding: ['De briefing: alles wat we al weten staat erbij, niet opnieuw vragen.', 'Zijn eigen klus klaarzetten in het portaal (maten, vloer).', 'De vergaderlink of het nummer checken; de afspraak bevestigd.'],
    stappen: ['Bevestigen wat we weten.', 'Zijn klus samen doorrekenen: inmeting, calculatie, offerte, bestelling.', 'De verdiepende vragen waar het past.', 'Wat moet er eerst opgelost zijn.', 'De volgende stap met eigenaar en datum: account, eerste project, of een nieuw moment.'],
    vastTeLeggen: ['wat getoond is, wat hij begreep, wat relevant was, het aha-moment', 'bezwaren en vragen apart', 'wat eerst opgelost moet worden', 'de volgende stap met eigenaar en datum'],
    uitkomsten: [{ uitkomst: 'account_gewenst', vervolg: 'de accountlink en helpen inrichten' }, { uitkomst: 'goede_interesse', vervolg: 'opvolgen na de demo volgens de reeks' }, { uitkomst: 'later_terugbellen', vervolg: 'op de afgesproken datum' }],
  },
  opvolging_na_demo: {
    voorbereiding: ['Wat is er in de demo afgesproken en wat was zijn twijfel.'],
    stappen: ['Hoe kijkt hij erop terug.', 'Wat is er nodig om te starten.', 'Het eerste project inplannen of een nieuwe datum.'],
    vastTeLeggen: ['de uitkomst', 'de reden om nog niet te starten', 'de volgende stap met datum'],
    uitkomsten: [{ uitkomst: 'account_gewenst', vervolg: 'accountlink en het eerste project' }, { uitkomst: 'nu_geen_behoefte', vervolg: 'pauze tot een datum' }],
  },
  onboarding: {
    voorbereiding: ['Het account bestaat; de mijlpalen van de partneractivatie erbij.'],
    stappen: ['Samen inloggen.', 'Bedrijfsprofiel, logo en bankrekening.', 'De eerste klant en het eerste project.', 'De volgende mijlpaal met datum.'],
    vastTeLeggen: ['wat is ingericht', 'wat blokkeert', 'de volgende stap met datum'],
    uitkomsten: [{ uitkomst: 'goede_interesse', vervolg: 'de volgende mijlpaal' }, { uitkomst: 'later_terugbellen', vervolg: 'op de afgesproken datum' }],
  },
  heractivatie: {
    voorbereiding: ['Wanneer was het laatste contact en waar stopte het.'],
    stappen: ['Hoe gaat het met de zaak.', 'Wat is er veranderd.', 'Een project aan de horizon.'],
    vastTeLeggen: ['de uitkomst', 'wat er veranderd is', 'de volgende datum'],
    uitkomsten: [{ uitkomst: 'goede_interesse', vervolg: 'een proefproject of demo' }, { uitkomst: 'nu_geen_behoefte', vervolg: 'bewust parkeren tot een datum' }],
  },
};
for (const [stap, delen] of Object.entries(SOP_DELEN)) Object.assign(SCRIPTS[stap], delen);

/*
  De werkwijze voor taken die geen gesprek zijn (aanvulling onderdeel 5): een bericht
  versturen, een reeks beoordelen, een gesprek administratief afronden. Zelfde vorm als de
  SOP-delen van een script, zodat het scherm ze op dezelfde manier toont.
*/
export const SOPS = {
  bericht: {
    titel: 'Een bericht versturen', versie: 'v1',
    doel: 'De afgesproken informatie of bevestiging versturen, in zijn taal, en vastleggen dat het echt weg is, met de termijn waarbinnen we een reactie verwachten.',
    voorbereiding: ['Welke template hoort bij deze stap; wat is er in het gesprek beloofd.', 'De link controleren.', 'Naam en context invullen.'],
    stappen: ['De template kiezen en aanpassen naar wat hij zei.', 'Versturen via WhatsApp of mail, buiten dit scherm.', 'Als verstuurd bevestigen, met de reactietermijn. Een klik op WhatsApp is geen bewijs.'],
    vastTeLeggen: ['kanaal, materiaal en de exacte link', 'de verzendstatus', 'de reactietermijn'],
    uitkomsten: [{ uitkomst: 'verstuurd', vervolg: 'geen reactie binnen de termijn: de reeks maakt de nabeltaak' }, { uitkomst: 'mislukt', vervolg: 'nummer of adres controleren, dan opnieuw' }],
  },
  beoordelen: {
    titel: 'Reeks afgelopen: beoordelen', versie: 'v1',
    doel: 'Bewust kiezen wat er met een lead gebeurt die op geen enkele stap reageerde: pauzeren tot een datum, stoppen, of nog een keer.',
    voorbereiding: ['De historie lezen: hoe vaak benaderd, via welk kanaal, welke reacties.', 'Is er een reden om aan te nemen dat het later wel past.'],
    stappen: ['Kiezen: pauze tot een datum (nu geen behoefte), stoppen (niet meer benaderen), of een laatste poging.', 'De reden erbij, in een zin.'],
    vastTeLeggen: ['het besluit met de reden'],
    uitkomsten: [{ uitkomst: 'gedaan', vervolg: 'de pauze of de eindfase staat op de lead' }, { uitkomst: 'verplaatst', vervolg: 'een nieuwe datum' }],
  },
  afronden: {
    titel: 'Een gesprek administratief afronden', versie: 'v1',
    doel: 'Een gesprek dat gevoerd is maar nog geen uitkomst heeft alsnog volledig vastleggen, zolang het vers is.',
    voorbereiding: ['De opname of je aantekeningen erbij; het AI-voorstel als dat er is.'],
    stappen: ['Uitkomst kiezen.', 'De drie vragen en de samenvatting.', 'Bezwaren en afspraken apart.', 'De volgende actie volgt uit de uitkomst.'],
    vastTeLeggen: ['uitkomst', 'de drie vragen', 'bezwaren', 'de volgende stap'],
    uitkomsten: [{ uitkomst: 'elke beluitkomst', vervolg: 'de fase en de volgende taak volgen vanzelf' }],
  },
};

/* De werkwijze bij een taak: het script van de stap voor een gesprek, anders de SOP van de taaksoort. */
export function sopVoor({ actie, stap, soort } = {}) {
  if (['whatsapp', 'email'].includes(actie)) return SOPS.bericht;
  if (actie === 'beoordelen' || actie === 'check_in' || soort === 'te_beoordelen') return SOPS.beoordelen;
  if (actie === 'afronden' || soort === 'af_te_ronden') return SOPS.afronden;
  return SCRIPTS[stap] || SCRIPTS.eerste_contact;
}

/*
  Vorige versies, op script_ref (stap@versie). Een oude registratie wijst met script_ref naar
  de versie die toen gold; hier is die terug te vinden voor het dossier en de rapportages.
*/
export const VORIGE_SCRIPTS = {
  'eerste_contact@v1-voorlopig': {
    stap: 'eerste_contact',
    versie: 'v1-voorlopig',
    bron: 'crm-veldcatalogus 04-08-2026 en gesprekssysteem 02-08-2026; wordt vervangen door het script van Myron',
    nodig: 'het nieuwe belscript van Myron (apart aangeleverd)',
    doel: 'De juiste persoon spreken, relevantie vaststellen, de situatie kort begrijpen, een eerste behoefte of bezwaar horen, en een passende volgende stap afspreken.',
    opening: [
      'Naam en bedrijf bevestigen: je spreekt met [naam] van Framr.One. Spreek ik met degene die over inkoop en offertes gaat?',
      'De opnamezin, direct na de begroeting: ik neem het gesprek even op voor mijn eigen aantekeningen, vind je dat goed? Zonder ja geen opname.',
      'Waarom je belt, in twintig seconden: we zijn met veel vloerenleggers in gesprek over hoe zij werken, en ik was benieuwd hoe jullie dat aanpakken.',
      'Een detail dat alleen klopt als je echt gekeken hebt (de briefing), en dan mond dicht.',
    ],
    vragen: [
      { vraag: 'Wat voor vloerwerk doen jullie voornamelijk, en voor wie?', vult: ['specialisme', 'b2c_of_b2b'], door: 'En hoeveel projecten doen jullie ongeveer per maand?', veld: 'projecten_per_maand' },
      { vraag: 'Waar koop je nu meestal je vloeren en materialen?', vult: ['huidige_vloerleverancier'], door: 'Wat vind je daar goed aan?', veld: 'huidige_vloerleverancier' },
      { vraag: 'Als je een ding zou mogen verbeteren aan hoe het nu gaat, wat zou dat zijn?', vult: ['grootste_pijnpunt'], door: 'Wat kost je daarvan de meeste tijd?', veld: 'grootste_pijnpunt' },
      { vraag: 'Wanneer heb je weer een nieuw project of een inmeting?', vult: ['opportunities'], door: 'Zullen we die dan eens samen doorrekenen, dan zie je meteen wat het doet?', veld: 'kans' },
    ],
    bijAarzeling: 'Wat houdt je tegen om het gewoon eens bij een project te proberen? Het antwoord is het bezwaar en de opvolgactie tegelijk.',
    afsluiting: [
      'Een kleine, veilige stap: zullen we dat project gewoon eens samen door Framr.One halen? Daarna beslis je zelf.',
      'Zonder concreet project: wanneer verwacht je weer een nieuw PVC-project? Datum noteren, opvolging op dat moment.',
      'Altijd: ik stuur je zo een WhatsApp met mijn gegevens en de pagina. Binnen vijf minuten na het gesprek.',
      'Elk gesprek eindigt in een concrete stap of een datum. Nooit in een prijsdiscussie, nooit in ik hoor nog van je.',
    ],
    naHetGesprek: [
      'Uitkomst kiezen: de fase en de volgende taak volgen vanzelf.',
      'Samenvatting in vier onderdelen: wie gesproken en in welke context, hoe hij nu werkt, wat de behoefte, kans of belemmering is, wat concreet is afgesproken.',
      'De drie vragen: wat wil hij wel, wat wil hij niet, en waarom.',
      'Elk bezwaar apart, letterlijk, met je reactie en of die werkte.',
      'Het volgende project als kans: naam, m2, datum.',
      'Extra dingen die je hoorde: een vraag, een inzicht, een productwens, persoonlijke context, een afspraak.',
      'De WhatsApp met de pagina versturen en als verstuurd bevestigen, met de reactietermijn.',
    ],
  
  },
};

/* Het script achter een script_ref: de huidige versie van die stap, of een vorige. */
export function scriptVoorRef(ref) {
  if (!ref) return null;
  const [stap, versie] = String(ref).split('@');
  const huidig = SCRIPTS[stap];
  if (huidig && (!versie || huidig.versie === versie)) return huidig;
  return VORIGE_SCRIPTS[ref] || huidig || null;
}

/* Voor de CLI en de oude aanroepen: het script van gesprek een. */
export const GESPREK_SCRIPT = SCRIPTS.eerste_contact;

export function scriptRef(stap) {
  const s = SCRIPTS[stap] || SCRIPTS.eerste_contact;
  return `${s.stap}@${s.versie}`;
}

/*
  Welke stap aan de beurt is voor een lead, uit zijn stand: de fase, de open afspraak, de open
  taak en het laatste contactmoment. Een lead na een demo krijgt niet het eerste belscript.
*/
export function kiesStap({ fase, openTaak, afspraak, laatsteInteractie, laatsteBericht } = {}) {
  const f = fase || '';
  if (openTaak && openTaak.task_type === 'service') return 'service';
  if (afspraak && ['gepland', 'verplaatst'].includes(afspraak.status)) return 'demo';
  if (openTaak && openTaak.task_type === 'demo') return 'demo';
  if (['demo_afgerond', 'account_aangeboden'].includes(f)) return 'opvolging_na_demo';
  if (['account_aangemaakt', 'onboarding', 'eerste_project'].includes(f)) return 'onboarding';
  if (['slapende_partner', 'later_benaderen', 'eerste_bestelling', 'actieve_partner'].includes(f)) return 'heractivatie';
  if (laatsteInteractie && laatsteInteractie.type === 'demo') return 'opvolging_na_demo';
  if (f === 'informatie_verstuurd' || (laatsteBericht && ['whatsapp', 'email'].includes(laatsteBericht.type))) return 'opvolging_na_informatie';
  if (['gesproken', 'gekwalificeerd', 'follow_up_nodig'].includes(f)) return 'opvolging_na_informatie';
  return 'eerste_contact';
}

/*
  De berichttemplates, met versie. De tekst is een startpunt dat de beller aanpast; wat er
  daadwerkelijk verstuurd is staat op het contactmoment (samenvatting, materiaal, link).
  Plaatsen als [naam] en [beller] vult het scherm in.
*/
export const BERICHT_TEMPLATES = [
  { ref: 'whatsapp_landingspagina@v1', kanaal: 'whatsapp', materiaal: 'landingspagina', stap: 'eerste_contact', naam: 'WhatsApp na het eerste gesprek', reactieTermijnDagen: 3,
    tekst: 'Hoi [naam], leuk je net gesproken te hebben. Hier de pagina waar ik het over had: [link]. Als je een project hebt rekenen we die er samen doorheen, dan zie je meteen wat je eraan overhoudt. Groet, [beller] van Framr.One' },
  { ref: 'email_landingspagina@v1', kanaal: 'email', materiaal: 'landingspagina', stap: 'eerste_contact', naam: 'Mail na het eerste gesprek', reactieTermijnDagen: 5,
    tekst: 'Beste [naam],\n\nBedankt voor het gesprek van vandaag. Zoals beloofd de pagina met uitleg over Framr.One voor vloerenleggers: [link].\n\nHeb je een project waar we het bij kunnen proberen, dan rekenen we die samen door.\n\nMet vriendelijke groet,\n[beller]\nFramr.One' },
  { ref: 'whatsapp_demo_uitnodiging@v1', kanaal: 'whatsapp', materiaal: 'demo_uitnodiging', stap: 'opvolging_na_informatie', naam: 'Demo bevestigen', reactieTermijnDagen: 2,
    tekst: 'Hoi [naam], onze demo staat op [datum] om [tijd] ([vorm]). Heb je de maten van een project bij de hand, dan rekenen we die meteen door. Tot dan, [beller]' },
  { ref: 'whatsapp_na_demo@v1', kanaal: 'whatsapp', materiaal: 'persoonlijk_bericht', stap: 'opvolging_na_demo', naam: 'Na de demo', reactieTermijnDagen: 3,
    tekst: 'Hoi [naam], bedankt voor je tijd vandaag. We spraken af: [afspraak]. Ik hoor graag wanneer je wilt starten met het eerste project. Groet, [beller]' },
  { ref: 'whatsapp_accountlink@v1', kanaal: 'whatsapp', materiaal: 'accountlink', stap: 'onboarding', naam: 'Accountlink', reactieTermijnDagen: 3,
    tekst: 'Hoi [naam], hier de link om je account aan te maken: [link]. Ik help je graag met het eerste project; zeg maar wanneer het uitkomt. Groet, [beller]' },
  { ref: 'whatsapp_heractivatie@v1', kanaal: 'whatsapp', materiaal: 'persoonlijk_bericht', stap: 'heractivatie', naam: 'Even checken', reactieTermijnDagen: 5,
    tekst: 'Hoi [naam], we hebben een tijd niets van elkaar gehoord. Heb je binnenkort weer een project waar ik bij kan helpen? Groet, [beller]' },
];

export function templateVoor(ref) {
  return BERICHT_TEMPLATES.find((t) => t.ref === ref) || null;
}

export function vulTemplate(tekst, waarden = {}) {
  return String(tekst || '').replace(/\[(\w+)\]/g, (m, k) => (waarden[k] !== undefined && waarden[k] !== null && waarden[k] !== '' ? String(waarden[k]) : m));
}
