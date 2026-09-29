/**
 * What the assistant says for each intent, in the customer's language.
 *
 * Two kinds of sentence live here. Most are frames around live data - "{route}
 * one-way fare from the portal's fare list:" with the fares filled in from the
 * fare master - so the figures cannot drift from what the office has set. The
 * rest restate what the portal already says (the Terms page, the FAQs) in
 * short form. None of them invents a price, a vehicle, a driver or a policy.
 *
 * Each line is written in five forms: English, Hindi, Hinglish, Marathi and
 * Marathi in Roman letters. The office can replace the wording of a static
 * answer from Admin > Chatbot Knowledge (see templateFor in assistantNlu.ts).
 */
import { COMPANY } from './siteData';
import type { Lang } from './assistantLang';

type Five = [en: string, hi: string, hiLatn: string, mr: string, mrLatn: string];
const COL: Record<Lang, number> = { en: 0, hi: 1, 'hi-Latn': 2, mr: 3, 'mr-Latn': 4 };

const PHONE = `+91 ${COMPANY.mobile}`;
const WA = `+91 ${COMPANY.whatsapp}`;

const TEXT = {
  /* ------------------------------------------------------------ menus */
  'menu.prompt': [
    'What would you like to do?', 'आप क्या करना चाहेंगे?', 'Aap kya karna chahenge?', 'तुम्हाला काय करायचे आहे?', 'Tumhala kay karaycha aahe?',
  ],
  'menu.more': [
    'Anything else I can help with?', 'और किसी चीज़ में मदद करूँ?', 'Aur kisi cheez mein madad karoon?',
    'आणखी काही मदत करू का?', 'Ankhi kahi madat karu ka?',
  ],

  /* ------------------------------------------------------------ fares */
  'fare.head': [
    '{route}{dist} - {leg} fare from the portal fare list:',
    '{route}{dist} - पोर्टल की किराया सूची से {leg} किराया:',
    '{route}{dist} - portal ki fare list se {leg} kiraya:',
    '{route}{dist} - पोर्टलच्या भाडे यादीतून {leg} भाडे:',
    '{route}{dist} - portal chya fare list madhun {leg} bhade:',
  ],
  'leg.oneWay': ['one-way', 'वन-वे', 'one-way', 'वन-वे', 'one-way'],
  'leg.return': ['return', 'रिटर्न', 'return', 'रिटर्न', 'return'],
  'toll.in': ['toll included', 'टोल शामिल', 'toll included', 'टोल समाविष्ट', 'toll included'],
  'toll.out': ['toll extra', 'टोल अलग', 'toll alag', 'टोल वेगळा', 'toll vegla'],
  'fare.onRequest': ['fare on request', 'किराया ऑफ़िस बताएगा', 'kiraya office batayega', 'भाडे ऑफिस सांगेल', 'bhade office sangel'],
  'fare.noneForLeg': [
    'There is no fixed {leg} fare for this route yet - the office quotes it.',
    'इस रूट का {leg} किराया अभी तय नहीं है - ऑफ़िस बताएगा।',
    'Is route ka {leg} kiraya abhi fixed nahi hai - office batayega.',
    'या मार्गाचे {leg} भाडे अजून ठरलेले नाही - ऑफिस सांगेल.',
    'Ya route che {leg} bhade ajun tharlela nahi - office sangel.',
  ],
  'fare.askBook': [
    'Shall I book it? Tap below, or ask for the {other} fare.',
    'बुक कर दूँ? नीचे टैप करें, या {other} किराया पूछें।',
    'Book kar doon? Neeche tap kijiye, ya {other} kiraya puchhiye.',
    'बुक करू का? खाली टॅप करा, किंवा {other} भाडे विचारा.',
    'Book karu ka? Khali tap kara, kinva {other} bhade vichara.',
  ],
  'fare.none': [
    'There is no fixed fare for {place} on the portal, so I will not guess one. The office quotes it for your trip - book it below as "Other", or send an enquiry.',
    'पोर्टल पर {place} का तय किराया नहीं है, इसलिए मैं अंदाज़ा नहीं लगाऊँगा। ऑफ़िस आपकी यात्रा के लिए किराया बताएगा - नीचे "अन्य" के रूप में बुक करें, या पूछताछ भेजें।',
    'Portal par {place} ka fixed kiraya nahi hai, isliye main andaza nahi lagaunga. Office aapki trip ke liye kiraya batayega - neeche "Other" ke roop mein book kijiye, ya enquiry bhejiye.',
    'पोर्टलवर {place} चे ठरलेले भाडे नाही, म्हणून मी अंदाज लावणार नाही. ऑफिस तुमच्या प्रवासासाठी भाडे सांगेल - खाली "इतर" म्हणून बुक करा, किंवा चौकशी पाठवा.',
    'Portal var {place} che tharlele bhade nahi, mhanun mi andaj lavnar nahi. Office tumchya pravasasathi bhade sangel - khali "Other" mhanun book kara, kinva enquiry pathva.',
  ],
  'fare.reversed': [
    'The fixed fares on the portal are for trips starting in Mumbai ({route}). For {from} → Mumbai the office quotes the fare.',
    'पोर्टल पर तय किराया मुंबई से शुरू होने वाली यात्राओं का है ({route})। {from} → मुंबई का किराया ऑफ़िस बताएगा।',
    'Portal par fixed kiraya Mumbai se shuru hone wali trips ka hai ({route}). {from} → Mumbai ka kiraya office batayega.',
    'पोर्टलवरील ठरलेले भाडे मुंबईहून सुरू होणाऱ्या प्रवासाचे आहे ({route}). {from} → मुंबईचे भाडे ऑफिस सांगेल.',
    'Portal varil tharlele bhade Mumbai-hun suru honarya pravasache aahe ({route}). {from} → Mumbai che bhade office sangel.',
  ],
  'fare.which': [
    'Which trip is the fare for? These routes from Mumbai have a fixed fare - or pick Local, Airport or Hourly.',
    'किराया किस यात्रा का चाहिए? मुंबई से इन रूट्स का किराया तय है - या लोकल, एयरपोर्ट या घंटे के हिसाब से चुनें।',
    'Kiraya kis trip ka chahiye? Mumbai se in routes ka fixed kiraya hai - ya Local, Airport ya Hourly chuniye.',
    'भाडे कोणत्या प्रवासाचे हवे? मुंबईहून या मार्गांचे भाडे ठरलेले आहे - किंवा लोकल, विमानतळ किंवा तासाप्रमाणे निवडा.',
    'Bhade kontya pravasache have? Mumbai-hun ya routes che bhade tharlele aahe - kinva Local, Airport kinva Hourly nivda.',
  ],
  'fare.local': [
    'Estimated {what} fares from the published rate card. Toll, parking and state tax are extra at actuals, and the office confirms the rate before the car is assigned:',
    'प्रकाशित रेट कार्ड से {what} का अनुमानित किराया। टोल, पार्किंग और स्टेट टैक्स असल के हिसाब से अलग हैं, और गाड़ी देने से पहले ऑफ़िस रेट पक्का करेगा:',
    'Published rate card se {what} ka anumanit kiraya. Toll, parking aur state tax actual ke hisaab se alag hain, aur gaadi dene se pehle office rate confirm karega:',
    'प्रकाशित रेट कार्डनुसार {what} चे अंदाजे भाडे. टोल, पार्किंग आणि राज्य कर प्रत्यक्ष खर्चाप्रमाणे वेगळे, आणि गाडी देण्याआधी ऑफिस दर निश्चित करेल:',
    'Published rate card nusar {what} che andaje bhade. Toll, parking ani state tax pratyaksha kharchapramane vegle, ani gaadi denyaadhi office rate confirm karel:',
  ],
  'fare.loading': [
    'The fare list is still loading - ask me again in a moment.', 'किराया सूची अभी लोड हो रही है - थोड़ी देर में फिर पूछें।',
    'Fare list abhi load ho rahi hai - thodi der mein phir puchhiye.', 'भाडे यादी अजून लोड होत आहे - थोड्या वेळाने पुन्हा विचारा.',
    'Fare list ajun load hot aahe - thodya velane punha vichara.',
  ],
  'fare.failed': [
    'I could not load the fare list just now, so I will not quote a fare from memory. The outstation page shows the current fares, or ask the office.',
    'अभी किराया सूची लोड नहीं हो पाई, इसलिए मैं याद से किराया नहीं बताऊँगा। आउटस्टेशन पेज पर मौजूदा किराया है, या ऑफ़िस से पूछें।',
    'Abhi fare list load nahi ho payi, isliye main yaad se kiraya nahi bataunga. Outstation page par current kiraya hai, ya office se puchhiye.',
    'आत्ता भाडे यादी लोड झाली नाही, म्हणून मी आठवणीतून भाडे सांगणार नाही. आउटस्टेशन पेजवर सध्याचे भाडे आहे, किंवा ऑफिसला विचारा.',
    'Atta fare list load jhali nahi, mhanun mi aathvanitun bhade sangnar nahi. Outstation page var sadhyache bhade aahe, kinva office la vichara.',
  ],

  /* ------------------------------------------------------------ toll */
  'toll.route': [
    '{route} - toll on the fixed fares:', '{route} - तय किराये में टोल:', '{route} - fixed kiraye mein toll:',
    '{route} - ठरलेल्या भाड्यात टोल:', '{route} - tharlelya bhadyat toll:',
  ],
  'toll.general': [
    'On local, airport and hourly trips, toll and parking are extra at actuals, each on its own line of the invoice. The fixed outstation fares say "toll included" where the toll is already in the price.',
    'लोकल, एयरपोर्ट और घंटे वाली यात्राओं पर टोल और पार्किंग असल के हिसाब से अलग लगते हैं, इनवॉइस में अलग लाइन में। आउटस्टेशन के तय किराये में जहाँ टोल शामिल है, वहाँ "टोल शामिल" लिखा होता है।',
    'Local, airport aur hourly trips par toll aur parking actual ke hisaab se alag lagte hain, invoice mein alag line mein. Outstation ke fixed kiraye mein jahan toll shamil hai, wahan "toll included" likha hota hai.',
    'लोकल, विमानतळ आणि तासाच्या प्रवासावर टोल आणि पार्किंग प्रत्यक्ष खर्चाप्रमाणे वेगळे, इनव्हॉइसवर स्वतंत्र ओळीत. आउटस्टेशनच्या ठरलेल्या भाड्यात टोल असेल तिथे "टोल समाविष्ट" लिहिलेले असते.',
    'Local, airport ani hourly pravasavar toll ani parking pratyaksha kharchapramane vegle, invoice var swatantra olit. Outstation chya tharlelya bhadyat toll asel tithe "toll included" lihilela asta.',
  ],

  /* ------------------------------------------------------------ a place */
  'place.ask': [
    'Are you looking for a cab to {place}? I can help with one way, return, or the fare.',
    'क्या आपको {place} के लिए कैब चाहिए? मैं वन-वे, रिटर्न या किराये में मदद कर सकता हूँ।',
    'Kya aapko {place} ke liye cab chahiye? Main one-way, return ya kiraye mein madad kar sakta hoon.',
    'तुम्हाला {place} साठी कॅब हवी आहे का? मी वन-वे, रिटर्न किंवा भाड्याबद्दल मदत करू शकतो.',
    'Tumhala {place} sathi cab havi aahe ka? Mi one-way, return kinva bhadyabaddal madat karu shakto.',
  ],

  /* ------------------------------------------------------------ vehicles */
  'vehicle.model': [
    '{name} - {category}, {seats} seats, {bags} large bags.', '{name} - {category}, {seats} सीटें, {bags} बड़े बैग।',
    '{name} - {category}, {seats} seats, {bags} bade bags.', '{name} - {category}, {seats} सीट, {bags} मोठ्या बॅगा.',
    '{name} - {category}, {seats} seats, {bags} mothya bags.',
  ],
  'vehicle.category': ['{label}:', '{label}:', '{label}:', '{label}:', '{label}:'],
  'vehicle.fleet': ['Our vehicles:', 'हमारी गाड़ियाँ:', 'Hamari gaadiyan:', 'आमच्या गाड्या:', 'Aamchya gaadya:'],
  'vehicle.confirm': [
    'The office confirms availability for your date when it allots the car.',
    'आपकी तारीख़ के लिए उपलब्धता ऑफ़िस गाड़ी देते समय पक्की करेगा।',
    'Aapki date ke liye availability office gaadi dete waqt confirm karega.',
    'तुमच्या तारखेसाठी उपलब्धता ऑफिस गाडी देताना निश्चित करेल.',
    'Tumchya tarkhesathi availability office gaadi detana confirm karel.',
  ],
  'capacity.fit': [
    'For {pax} passengers, these seat everyone (not counting the chauffeur):',
    '{pax} यात्रियों के लिए ये गाड़ियाँ सबको बैठा सकती हैं (ड्राइवर के अलावा):',
    '{pax} logon ke liye yeh gaadiyan sabko baitha sakti hain (driver ke alawa):',
    '{pax} प्रवाशांसाठी या गाड्यांत सगळे बसतील (चालक सोडून):',
    '{pax} pravashansathi ya gaadyant sagle bastil (chalak sodun):',
  ],
  'capacity.many': [
    'For {pax} passengers we run more than one vehicle together - the office arranges it.',
    '{pax} यात्रियों के लिए एक से ज़्यादा गाड़ियाँ साथ चलती हैं - ऑफ़िस इंतज़ाम करेगा।',
    '{pax} logon ke liye ek se zyada gaadiyan saath chalti hain - office intezaam karega.',
    '{pax} प्रवाशांसाठी एकापेक्षा जास्त गाड्या एकत्र जातात - ऑफिस व्यवस्था करेल.',
    '{pax} pravashansathi ekapeksha jast gaadya ekatra jatat - office vyavastha karel.',
  ],
  'capacity.list': [
    'Seats, not counting the chauffeur:', 'सीटें (ड्राइवर के अलावा):', 'Seats (driver ke alawa):', 'सीट (चालक सोडून):', 'Seats (chalak sodun):',
  ],

  /* ------------------------------------------------------------ an existing trip */
  'status.askId': [
    'Please share your Trip ID - it looks like GTT-WA-2609-0014 and is in your confirmation message and email.',
    'कृपया अपनी ट्रिप आईडी बताइए - यह GTT-WA-2609-0014 जैसी होती है और कन्फ़र्मेशन मैसेज व ईमेल में है।',
    'Please apni Trip ID bataiye - yeh GTT-WA-2609-0014 jaisi hoti hai aur confirmation message aur email mein hai.',
    'कृपया तुमचा ट्रिप आयडी सांगा - तो GTT-WA-2609-0014 सारखा असतो आणि कन्फर्मेशन मेसेज व ईमेलमध्ये आहे.',
    'Krupaya tumcha Trip ID sanga - to GTT-WA-2609-0014 sarkha asto ani confirmation message va email madhye aahe.',
  ],
  'status.badId': [
    'That does not look like a Trip ID. It looks like GTT-WA-2609-0014.', 'यह ट्रिप आईडी नहीं लग रही। यह GTT-WA-2609-0014 जैसी होती है।',
    'Yeh Trip ID nahi lag rahi. Yeh GTT-WA-2609-0014 jaisi hoti hai.', 'हा ट्रिप आयडी वाटत नाही. तो GTT-WA-2609-0014 सारखा असतो.',
    'Ha Trip ID vatat nahi. To GTT-WA-2609-0014 sarkha asto.',
  ],
  'status.askDigits': [
    'Thanks. To keep your booking private, what are the last 4 digits of the mobile number on it?',
    'धन्यवाद। आपकी बुकिंग सुरक्षित रखने के लिए, उस पर दर्ज मोबाइल नंबर के आख़िरी 4 अंक क्या हैं?',
    'Thanks. Aapki booking safe rakhne ke liye, us par diye mobile number ke aakhri 4 digit kya hain?',
    'धन्यवाद. तुमची बुकिंग सुरक्षित ठेवण्यासाठी, त्यावरील मोबाइल नंबरचे शेवटचे 4 अंक कोणते?',
    'Dhanyavad. Tumchi booking surakshit thevnyasathi, tyavaril mobile number che shevatche 4 digit konte?',
  ],
  'status.notFound': [
    'I could not find that Trip ID with those digits. Please check both, or call us on {phone}.',
    'इन अंकों के साथ वह ट्रिप आईडी नहीं मिली। कृपया दोनों जाँचें, या {phone} पर कॉल करें।',
    'In digits ke saath woh Trip ID nahi mili. Please dono check kijiye, ya {phone} par call kijiye.',
    'या अंकांसह तो ट्रिप आयडी सापडला नाही. कृपया दोन्ही तपासा, किंवा {phone} वर कॉल करा.',
    'Ya ankansah to Trip ID sapadla nahi. Krupaya donhi tapasa, kinva {phone} var call kara.',
  ],
  'status.error': [
    'I could not look that up just now. Please try again, or call us on {phone}.',
    'अभी यह देख नहीं पाया। कृपया फिर कोशिश करें, या {phone} पर कॉल करें।',
    'Abhi yeh dekh nahi paaya. Please phir try kijiye, ya {phone} par call kijiye.',
    'आत्ता हे पाहता आले नाही. कृपया पुन्हा प्रयत्न करा, किंवा {phone} वर कॉल करा.',
    'Atta he pahta aala nahi. Krupaya punha prayatna kara, kinva {phone} var call kara.',
  ],
  'status.head': ['Trip {id}: {status}.', 'ट्रिप {id}: {status}।', 'Trip {id}: {status}.', 'ट्रिप {id}: {status}.', 'Trip {id}: {status}.'],
  'status.assigned': [
    'Car: {vehicle}\nChauffeur: {driver}', 'गाड़ी: {vehicle}\nड्राइवर: {driver}', 'Gaadi: {vehicle}\nDriver: {driver}',
    'गाडी: {vehicle}\nचालक: {driver}', 'Gaadi: {vehicle}\nChalak: {driver}',
  ],
  'status.notAssigned': [
    'The car and chauffeur are not assigned yet - their details are sent to you before the reporting time.',
    'गाड़ी और ड्राइवर अभी तय नहीं हुए हैं - उनकी जानकारी रिपोर्टिंग टाइम से पहले भेजी जाएगी।',
    'Gaadi aur driver abhi assign nahi hue hain - unki details reporting time se pehle bheji jayengi.',
    'गाडी आणि चालक अजून ठरलेले नाहीत - त्यांची माहिती रिपोर्टिंग वेळेआधी पाठवली जाईल.',
    'Gaadi ani chalak ajun tharlele nahit - tyanchi mahiti reporting veleaadhi pathavli jail.',
  ],

  /* ------------------------------------------------------------ policies, from the portal */
  cancel: [
    'Cancelling up to 1 hour before the pickup time is free; a cancellation within 1 hour of pickup is chargeable.\n\nTo cancel, call the office on {phone} with your Trip ID - marking a trip cancelled on the website only changes your own copy; the car is released once you have spoken to us.',
    'पिकअप समय से 1 घंटा पहले तक रद्द करना मुफ़्त है; पिकअप से 1 घंटे के अंदर रद्द करने पर शुल्क लगता है।\n\nरद्द करने के लिए अपनी ट्रिप आईडी के साथ {phone} पर ऑफ़िस को कॉल करें - वेबसाइट पर रद्द करने से सिर्फ़ आपकी कॉपी बदलती है; गाड़ी तब छोड़ी जाती है जब आप हमसे बात कर लें।',
    'Pickup time se 1 ghanta pehle tak cancel karna free hai; pickup se 1 ghante ke andar cancel karne par charge lagta hai.\n\nCancel karne ke liye apni Trip ID ke saath {phone} par office ko call kijiye - website par cancel karne se sirf aapki copy badalti hai; gaadi tab chhodi jaati hai jab aap humse baat kar lein.',
    'पिकअपच्या वेळेच्या 1 तास आधीपर्यंत रद्द करणे मोफत; पिकअपच्या 1 तासाच्या आत रद्द केल्यास शुल्क लागते.\n\nरद्द करण्यासाठी तुमच्या ट्रिप आयडीसह {phone} वर ऑफिसला कॉल करा - वेबसाइटवर रद्द केल्याने फक्त तुमची प्रत बदलते; तुम्ही आमच्याशी बोलल्यावर गाडी सोडली जाते.',
    'Pickup chya velechya 1 taas aadhiparyant radd karne mofat; pickup chya 1 tasachya aat radd kelyas shulk lagte.\n\nRadd karnyasathi tumchya Trip ID sah {phone} var office la call kara - website var radd kelyane fakt tumchi prat badalte; tumhi aamchyashi bollyavar gaadi sodli jaate.',
  ],
  modify: [
    'Tell the office as early as you can, with your Trip ID - call or WhatsApp {phone}. We move the booking rather than cancel it wherever possible. If a change close to the reporting time does attract a charge, you are told at the time.',
    'जितनी जल्दी हो सके, अपनी ट्रिप आईडी के साथ ऑफ़िस को बताइए - {phone} पर कॉल या WhatsApp करें। जहाँ तक हो सके हम बुकिंग रद्द करने के बजाय बदल देते हैं। रिपोर्टिंग टाइम के पास बदलाव पर शुल्क लगे, तो उसी समय बताया जाता है।',
    'Jitni jaldi ho sake, apni Trip ID ke saath office ko bataiye - {phone} par call ya WhatsApp kijiye. Jahan tak ho sake hum booking cancel karne ke bajaye badal dete hain. Reporting time ke paas badlav par charge lage, to usi samay bataya jaata hai.',
    'शक्य तितक्या लवकर तुमच्या ट्रिप आयडीसह ऑफिसला कळवा - {phone} वर कॉल किंवा WhatsApp करा. शक्य असेल तिथे आम्ही बुकिंग रद्द न करता बदलतो. रिपोर्टिंग वेळेजवळ बदलावर शुल्क लागले, तर ते त्याच वेळी सांगितले जाते.',
    'Shakya titkya lavkar tumchya Trip ID sah office la kalva - {phone} var call kinva WhatsApp kara. Shakya asel tithe aamhi booking radd na karta badalto. Reporting velejaval badlavar shulk lagla, tar te tyach veli sangitla jaato.',
  ],
  payment: [
    'For a one-off booking the amount is confirmed with you before the trip and settled on completion. Corporate accounts are invoiced on an agreed cycle.\n\nThe portal does not list particular payment methods (UPI, cash or card), so I will not promise one - the office tells you when it confirms the rate.',
    'एक बार की बुकिंग में रकम यात्रा से पहले आपके साथ तय होती है और यात्रा पूरी होने पर चुकाई जाती है। कॉर्पोरेट खातों का बिल तय चक्र पर बनता है।\n\nपोर्टल पर भुगतान के खास तरीक़े (UPI, नकद या कार्ड) नहीं लिखे हैं, इसलिए मैं वादा नहीं करूँगा - रेट पक्का करते समय ऑफ़िस बता देगा।',
    'Ek baar ki booking mein amount trip se pehle aapke saath tay hota hai aur trip poori hone par diya jaata hai. Corporate accounts ka bill tay cycle par banta hai.\n\nPortal par payment ke khaas tareeke (UPI, cash ya card) nahi likhe hain, isliye main promise nahi karunga - rate confirm karte waqt office bata dega.',
    'एकदाच्या बुकिंगमध्ये रक्कम प्रवासाआधी तुमच्याशी ठरते आणि प्रवास पूर्ण झाल्यावर दिली जाते. कॉर्पोरेट खात्यांचे बिल ठरलेल्या कालावधीने होते.\n\nपोर्टलवर पेमेंटच्या विशिष्ट पद्धती (UPI, रोख किंवा कार्ड) लिहिलेल्या नाहीत, म्हणून मी खात्री देणार नाही - दर निश्चित करताना ऑफिस सांगेल.',
    'Ekdachya booking madhye rakkam pravasaadhi tumchyashi tharte ani pravas purna jhalyavar dili jaate. Corporate khatyanche bill tharlelya kalavadhine hote.\n\nPortal var payment chya vishishta paddhati (UPI, cash kinva card) lihilelya nahit, mhanun mi khatri denar nahi - rate confirm kartana office sangel.',
  ],
  invoice: [
    'Every invoice is GST-compliant. Once your trip is completed and invoiced, it is emailed to you and you can download it under My trips - sign in with the email on the booking. For a GST invoice, give your GSTIN when you book.',
    'हर इनवॉइस GST के अनुसार होता है। यात्रा पूरी होने और इनवॉइस बनने के बाद वह आपको ईमेल होता है, और "My trips" में डाउनलोड कर सकते हैं - बुकिंग वाले ईमेल से साइन इन करें। GST इनवॉइस के लिए बुकिंग के समय अपना GSTIN दें।',
    'Har invoice GST ke hisaab se hota hai. Trip poori hone aur invoice banne ke baad woh aapko email hota hai, aur "My trips" mein download kar sakte hain - booking wale email se sign in kijiye. GST invoice ke liye booking ke waqt apna GSTIN dijiye.',
    'प्रत्येक इनव्हॉइस GST नुसार असते. प्रवास पूर्ण होऊन इनव्हॉइस तयार झाल्यावर ते तुम्हाला ईमेल होते, आणि "My trips" मध्ये डाउनलोड करता येते - बुकिंगच्या ईमेलने साइन इन करा. GST इनव्हॉइससाठी बुकिंग करताना तुमचा GSTIN द्या.',
    'Pratyek invoice GST nusar aste. Pravas purna houn invoice tayar jhalyavar te tumhala email hote, ani "My trips" madhye download karta yete - booking chya email ne sign in kara. GST invoice sathi booking kartana tumcha GSTIN dya.',
  ],
  whatsapp: [
    'Tap below: WhatsApp opens with the details already written - choose the chat and press Send. Our WhatsApp number is {wa}.',
    'नीचे टैप करें: WhatsApp में जानकारी पहले से लिखी खुलेगी - चैट चुनें और Send दबाएँ। हमारा WhatsApp नंबर {wa} है।',
    'Neeche tap kijiye: WhatsApp mein details pehle se likhi khulengi - chat chuniye aur Send dabaiye. Hamara WhatsApp number {wa} hai.',
    'खाली टॅप करा: WhatsApp मध्ये माहिती आधीच लिहिलेली उघडेल - चॅट निवडा आणि Send दाबा. आमचा WhatsApp नंबर {wa} आहे.',
    'Khali tap kara: WhatsApp madhye mahiti aadhich lihileli ughdel - chat nivda ani Send daba. Aamcha WhatsApp number {wa} aahe.',
  ],
  contact: [
    'Call {phone} ({hours}) - it goes to {owner}, with no call-centre queue. WhatsApp: {wa}\nEmail: {email}\nOffice: {address}',
    '{phone} पर कॉल करें ({hours}) - सीधे {owner} से बात होगी, कोई कॉल-सेंटर लाइन नहीं। WhatsApp: {wa}\nईमेल: {email}\nऑफ़िस: {address}',
    '{phone} par call kijiye ({hours}) - seedhe {owner} se baat hogi, koi call-centre line nahi. WhatsApp: {wa}\nEmail: {email}\nOffice: {address}',
    '{phone} वर कॉल करा ({hours}) - थेट {owner} यांच्याशी बोलणे होईल, कॉल-सेंटरची रांग नाही. WhatsApp: {wa}\nईमेल: {email}\nऑफिस: {address}',
    '{phone} var call kara ({hours}) - thet {owner} yanchyashi bolna hoil, call-centre chi rang nahi. WhatsApp: {wa}\nEmail: {email}\nOffice: {address}',
  ],
  help: [
    'Of course. I can book a cab, give you a fare, look up your booking or put you through to the office. What do you need?',
    'ज़रूर। मैं कैब बुक कर सकता हूँ, किराया बता सकता हूँ, आपकी बुकिंग देख सकता हूँ या ऑफ़िस से बात करवा सकता हूँ। क्या चाहिए?',
    'Zaroor. Main cab book kar sakta hoon, kiraya bata sakta hoon, aapki booking dekh sakta hoon ya office se baat karwa sakta hoon. Kya chahiye?',
    'नक्की. मी कॅब बुक करू शकतो, भाडे सांगू शकतो, तुमची बुकिंग पाहू शकतो किंवा ऑफिसशी बोलणे करून देऊ शकतो. काय हवे?',
    'Nakki. Mi cab book karu shakto, bhade sangu shakto, tumchi booking pahu shakto kinva office shi bolna karun deu shakto. Kay have?',
  ],
  corporate: [
    'Yes - corporate travel is most of what we do. A corporate account gets an agreed rate card, a billing cycle that suits your accounts team, GST invoices and one point of contact. Send a corporate request and the office will call you.',
    'हाँ - हमारा ज़्यादातर काम कॉर्पोरेट यात्रा का है। कॉर्पोरेट खाते को तय रेट कार्ड, आपकी अकाउंट्स टीम के हिसाब से बिलिंग, GST इनवॉइस और एक संपर्क व्यक्ति मिलता है। कॉर्पोरेट रिक्वेस्ट भेजें, ऑफ़िस कॉल करेगा।',
    'Haan - hamara zyadatar kaam corporate travel ka hai. Corporate account ko fixed rate card, aapki accounts team ke hisaab se billing, GST invoice aur ek contact person milta hai. Corporate request bhejiye, office call karega.',
    'हो - आमचे बहुतेक काम कॉर्पोरेट प्रवासाचे आहे. कॉर्पोरेट खात्याला ठरलेले रेट कार्ड, तुमच्या अकाउंट्स टीमला सोयीचे बिलिंग, GST इनव्हॉइस आणि एक संपर्क व्यक्ती मिळते. कॉर्पोरेट विनंती पाठवा, ऑफिस कॉल करेल.',
    'Ho - aamche bahutek kaam corporate pravasache aahe. Corporate khatyala tharlela rate card, tumchya accounts team la soyiche billing, GST invoice ani ek samparka vyakti milte. Corporate request pathva, office call karel.',
  ],
  bulk: [
    'Yes - several vehicles on the same day are coordinated under one point of contact, and each is logged as its own booking so the bill adds up. Tell us the requirement and the office will plan it.',
    'हाँ - एक ही दिन कई गाड़ियाँ एक संपर्क व्यक्ति के ज़रिए चलती हैं, और हर गाड़ी अलग बुकिंग में दर्ज होती है। अपनी ज़रूरत बताइए, ऑफ़िस योजना बनाएगा।',
    'Haan - ek hi din kai gaadiyan ek contact person ke zariye chalti hain, aur har gaadi alag booking mein darj hoti hai. Apni requirement bataiye, office plan karega.',
    'हो - एकाच दिवशी अनेक गाड्या एका संपर्क व्यक्तीमार्फत चालतात, आणि प्रत्येक गाडी स्वतंत्र बुकिंग म्हणून नोंदवली जाते. तुमची गरज सांगा, ऑफिस नियोजन करेल.',
    'Ho - ekach divshi anek gaadya eka samparka vyaktimarfat chaltat, ani pratyek gaadi swatantra booking mhanun nondavli jaate. Tumchi garaj sanga, office niyojan karel.',
  ],
  feedback: [
    'When the office marks your trip completed, we email you a "Give Your Feedback" link. It asks you to rate the driver, the service, the cab and your overall experience (1 to 5 stars), with room for comments - one response per trip.\n\nNo email? Check spam, or leave your Trip ID below and we will send it again.',
    'जब ऑफ़िस आपकी यात्रा पूरी दर्ज करता है, हम आपको "Give Your Feedback" लिंक ईमेल करते हैं। उसमें ड्राइवर, सेवा, कैब और पूरे अनुभव को 1 से 5 स्टार देने और टिप्पणी लिखने की जगह है - हर यात्रा पर एक जवाब।\n\nईमेल नहीं मिला? स्पैम देखें, या नीचे अपनी ट्रिप आईडी दें, हम फिर भेज देंगे।',
    'Jab office aapki trip complete mark karta hai, hum aapko "Give Your Feedback" link email karte hain. Usmein driver, service, cab aur overall experience ko 1 se 5 star dene aur comments likhne ki jagah hai - har trip par ek response.\n\nEmail nahi mila? Spam dekhiye, ya neeche apni Trip ID dijiye, hum phir bhej denge.',
    'ऑफिसने तुमचा प्रवास पूर्ण म्हणून नोंदवल्यावर आम्ही तुम्हाला "Give Your Feedback" लिंक ईमेल करतो. त्यात चालक, सेवा, कॅब आणि एकूण अनुभवाला 1 ते 5 स्टार देण्याची आणि टिप्पणी लिहिण्याची सोय आहे - प्रत्येक प्रवासासाठी एक प्रतिसाद.\n\nईमेल आला नाही? स्पॅम पाहा, किंवा खाली तुमचा ट्रिप आयडी द्या, आम्ही पुन्हा पाठवू.',
    'Office ne tumcha pravas purna mhanun nondavlyavar aamhi tumhala "Give Your Feedback" link email karto. Tyat chalak, seva, cab ani ekun anubhavala 1 te 5 star denyachi ani tippani lihinyachi soy aahe - pratyek pravasasathi ek pratisad.\n\nEmail aala nahi? Spam paha, kinva khali tumcha Trip ID dya, aamhi punha pathvu.',
  ],
  complaint: [
    "I'm sorry about that. Please tell us what happened - with your Trip ID or the date if you have it - and your name and number below. It goes straight to {owner}, who handles it personally.",
    'इसके लिए माफ़ी चाहते हैं। कृपया नीचे बताइए क्या हुआ - ट्रिप आईडी या तारीख़ हो तो वह भी - और अपना नाम व नंबर। यह सीधे {owner} तक जाएगा, जो खुद देखेंगे।',
    'Iske liye maafi chahte hain. Please neeche bataiye kya hua - Trip ID ya date ho to woh bhi - aur apna naam aur number. Yeh seedhe {owner} tak jayega, jo khud dekhenge.',
    'याबद्दल आम्ही दिलगीर आहोत. कृपया खाली काय झाले ते सांगा - ट्रिप आयडी किंवा तारीख असल्यास तीही - आणि तुमचे नाव व नंबर. हे थेट {owner} यांच्याकडे जाईल, जे स्वतः पाहतील.',
    'Yabaddal aamhi dilgir aahot. Krupaya khali kay jhala te sanga - Trip ID kinva tarikh aslyas tihi - ani tumche naav va number. He thet {owner} yanchyakade jail, je swataha pahtil.',
  ],
  suggestion: [
    'Thank you - we would like to hear it. Write it below with your name and number, and it goes to {owner}.',
    'धन्यवाद - हम ज़रूर सुनना चाहेंगे। नीचे अपना नाम और नंबर के साथ लिखिए, यह {owner} तक जाएगा।',
    'Thank you - hum zaroor sunna chahenge. Neeche apna naam aur number ke saath likhiye, yeh {owner} tak jayega.',
    'धन्यवाद - आम्हाला नक्की ऐकायला आवडेल. खाली तुमचे नाव व नंबरसह लिहा, हे {owner} यांच्याकडे जाईल.',
    'Dhanyavad - aamhala nakki aikayla aavdel. Khali tumche naav va number sah liha, he {owner} yanchyakade jail.',
  ],
  multistop: [
    'On an hourly package the car and chauffeur stay with you and you can make as many stops as you need. On other trips, mention the extra pickup or drop when you book (in Notes) - the office confirms it and any change to the fare.',
    'घंटे वाले पैकेज में गाड़ी और ड्राइवर आपके साथ रहते हैं, जितने चाहें उतने स्टॉप कर सकते हैं। बाकी यात्राओं में बुकिंग करते समय (Notes में) एक और पिकअप या ड्रॉप लिखें - ऑफ़िस उसे और किराये में बदलाव को पक्का करेगा।',
    'Hourly package mein gaadi aur driver aapke saath rehte hain, jitne chahein utne stop kar sakte hain. Baaki trips mein booking karte waqt (Notes mein) ek aur pickup ya drop likhiye - office use aur kiraye mein badlav ko confirm karega.',
    'तासाच्या पॅकेजमध्ये गाडी आणि चालक तुमच्यासोबत राहतात, हवे तितके थांबे घेता येतात. इतर प्रवासात बुकिंग करताना (Notes मध्ये) आणखी पिकअप किंवा ड्रॉप लिहा - ऑफिस ते आणि भाड्यातील बदल निश्चित करेल.',
    'Tasachya package madhye gaadi ani chalak tumchyasobat rahtat, have titke thambe gheta yetat. Itar pravasat booking kartana (Notes madhye) ankhi pickup kinva drop liha - office te ani bhadyatil badal confirm karel.',
  ],
  pickupInfo: [
    'You choose the pickup address when you book - type it here in the chat or in the booking bar. From the airport, the chauffeur meets you at the arrivals pickup point and calls as you land.',
    'पिकअप का पता आप बुकिंग करते समय चुनते हैं - यहीं चैट में या बुकिंग बार में लिखिए। एयरपोर्ट से ड्राइवर अराइवल्स पिकअप पॉइंट पर मिलता है और लैंड करते ही कॉल करता है।',
    'Pickup ka address aap booking karte waqt chunte hain - yahin chat mein ya booking bar mein likhiye. Airport se driver arrivals pickup point par milta hai aur land karte hi call karta hai.',
    'पिकअपचा पत्ता तुम्ही बुकिंग करताना निवडता - इथेच चॅटमध्ये किंवा बुकिंग बारमध्ये लिहा. विमानतळावरून चालक अरायव्हल्स पिकअप पॉइंटवर भेटतो आणि तुम्ही उतरताच कॉल करतो.',
    'Pickup cha patta tumhi booking kartana nivadta - ithech chat madhye kinva booking bar madhye liha. Airport varun chalak arrivals pickup point var bhetto ani tumhi utartach call karto.',
  ],
  dropInfo: [
    'You choose the drop address when you book, and it can be changed by telling the office with your Trip ID.',
    'ड्रॉप का पता आप बुकिंग करते समय चुनते हैं, और ट्रिप आईडी के साथ ऑफ़िस को बताकर बदल सकते हैं।',
    'Drop ka address aap booking karte waqt chunte hain, aur Trip ID ke saath office ko batakar badal sakte hain.',
    'ड्रॉपचा पत्ता तुम्ही बुकिंग करताना निवडता, आणि ट्रिप आयडीसह ऑफिसला सांगून बदलता येतो.',
    'Drop cha patta tumhi booking kartana nivadta, ani Trip ID sah office la sangun badalta yeto.',
  ],
  when: [
    'Yes - we run 24×7, and same-day bookings are usually possible. For an early-morning airport pickup or an outstation trip, 12 to 24 hours notice gives you the pick of the fleet. Shall I book it?',
    'हाँ - हम 24×7 चलते हैं, और उसी दिन की बुकिंग आमतौर पर हो जाती है। सुबह-सुबह एयरपोर्ट पिकअप या आउटस्टेशन के लिए 12-24 घंटे पहले बताने पर सबसे अच्छी गाड़ी मिलती है। बुक करूँ?',
    'Haan - hum 24×7 chalte hain, aur usi din ki booking aamtaur par ho jaati hai. Subah-subah airport pickup ya outstation ke liye 12-24 ghante pehle batane par sabse achhi gaadi milti hai. Book karoon?',
    'हो - आम्ही 24×7 चालतो, आणि त्याच दिवशीची बुकिंग सहसा होते. पहाटेच्या विमानतळ पिकअप किंवा आउटस्टेशनसाठी 12-24 तास आधी कळवल्यास उत्तम गाडी मिळते. बुक करू का?',
    'Ho - aamhi 24×7 chalto, ani tyach divshichi booking sahsa hote. Pahatechya airport pickup kinva outstation sathi 12-24 taas aadhi kalavlyas uttam gaadi milte. Book karu ka?',
  ],
  services: [
    'You can book:\n• Local - within Mumbai, Thane and Navi Mumbai\n• Airport transfers - to or from the airport\n• Outstation - one way or return, fixed fares on set routes from Mumbai\n• Hourly packages - 4, 8 or 12 hours\n• Corporate accounts, events and weddings, and tour packages',
    'आप बुक कर सकते हैं:\n• लोकल - मुंबई, ठाणे और नवी मुंबई में\n• एयरपोर्ट ट्रांसफ़र - एयरपोर्ट जाना या आना\n• आउटस्टेशन - वन-वे या रिटर्न, मुंबई से तय रूट्स पर तय किराया\n• घंटे वाले पैकेज - 4, 8 या 12 घंटे\n• कॉर्पोरेट खाते, इवेंट और शादी, और टूर पैकेज',
    'Aap book kar sakte hain:\n• Local - Mumbai, Thane aur Navi Mumbai mein\n• Airport transfer - airport jaana ya aana\n• Outstation - one-way ya return, Mumbai se fixed routes par fixed kiraya\n• Hourly package - 4, 8 ya 12 ghante\n• Corporate account, event aur shaadi, aur tour package',
    'तुम्ही बुक करू शकता:\n• लोकल - मुंबई, ठाणे आणि नवी मुंबईत\n• विमानतळ ट्रान्सफर - विमानतळावर जाणे किंवा येणे\n• आउटस्टेशन - वन-वे किंवा रिटर्न, मुंबईहून ठरलेल्या मार्गांवर ठरलेले भाडे\n• तासाचे पॅकेज - 4, 8 किंवा 12 तास\n• कॉर्पोरेट खाती, कार्यक्रम व लग्न, आणि टूर पॅकेज',
    'Tumhi book karu shakta:\n• Local - Mumbai, Thane ani Navi Mumbait\n• Airport transfer - airport var jane kinva yene\n• Outstation - one-way kinva return, Mumbai-hun tharlelya routes var tharlele bhade\n• Hourly package - 4, 8 kinva 12 taas\n• Corporate khati, karyakram va lagna, ani tour package',
  ],
  'service.LOCAL': [
    'Yes - local cabs run across Mumbai, Thane and Navi Mumbai, 24×7. Shall I book one?',
    'हाँ - लोकल कैब मुंबई, ठाणे और नवी मुंबई में 24×7 चलती हैं। बुक करूँ?',
    'Haan - local cab Mumbai, Thane aur Navi Mumbai mein 24×7 chalti hain. Book karoon?',
    'हो - लोकल कॅब मुंबई, ठाणे आणि नवी मुंबईत 24×7 चालतात. बुक करू का?',
    'Ho - local cab Mumbai, Thane ani Navi Mumbait 24×7 chaltat. Book karu ka?',
  ],
  'service.AIRPORT': [
    'Yes - pickups and drops at {airports}, at any hour. Give the flight number and the chauffeur follows the actual landing time. Shall I book one?',
    'हाँ - {airports} पर पिकअप और ड्रॉप, किसी भी समय। फ़्लाइट नंबर दें तो ड्राइवर असली लैंडिंग टाइम के हिसाब से आता है। बुक करूँ?',
    'Haan - {airports} par pickup aur drop, kisi bhi time. Flight number dijiye to driver actual landing time ke hisaab se aata hai. Book karoon?',
    'हो - {airports} येथे पिकअप आणि ड्रॉप, कोणत्याही वेळी. फ्लाइट नंबर दिल्यास चालक प्रत्यक्ष उतरण्याच्या वेळेनुसार येतो. बुक करू का?',
    'Ho - {airports} yethe pickup ani drop, kontyahi veli. Flight number dilyas chalak pratyaksha utarnyachya velenusar yeto. Book karu ka?',
  ],
  'service.OUTSTATION': [
    'Yes - one way or return from Mumbai. These routes have a fixed fare; anywhere else is quoted by the office. Shall I book one?',
    'हाँ - मुंबई से वन-वे या रिटर्न। इन रूट्स का किराया तय है; बाकी जगहों का ऑफ़िस बताएगा। बुक करूँ?',
    'Haan - Mumbai se one-way ya return. In routes ka kiraya fixed hai; baaki jagahon ka office batayega. Book karoon?',
    'हो - मुंबईहून वन-वे किंवा रिटर्न. या मार्गांचे भाडे ठरलेले आहे; इतर ठिकाणांचे ऑफिस सांगेल. बुक करू का?',
    'Ho - Mumbai-hun one-way kinva return. Ya routes che bhade tharlele aahe; itar thikananche office sangel. Book karu ka?',
  ],
  'service.HOURLY': [
    'Yes - hourly packages of 4 hrs / 40 km, 8 hrs / 80 km and 12 hrs / 120 km, with the car and chauffeur with you throughout. Shall I book one?',
    'हाँ - 4 घंटे / 40 किमी, 8 घंटे / 80 किमी और 12 घंटे / 120 किमी के पैकेज, गाड़ी और ड्राइवर पूरे समय आपके साथ। बुक करूँ?',
    'Haan - 4 ghante / 40 km, 8 ghante / 80 km aur 12 ghante / 120 km ke package, gaadi aur driver poore time aapke saath. Book karoon?',
    'हो - 4 तास / 40 किमी, 8 तास / 80 किमी आणि 12 तास / 120 किमीचे पॅकेज, गाडी आणि चालक पूर्ण वेळ तुमच्यासोबत. बुक करू का?',
    'Ho - 4 taas / 40 km, 8 taas / 80 km ani 12 taas / 120 km che package, gaadi ani chalak purna vel tumchyasobat. Book karu ka?',
  ],
  outOfScope: [
    'I can help you with our cab and travel services - bookings, fares, vehicles, airport transfers, outstation trips, hourly rentals and booking support. For anything else, please call or WhatsApp us.',
    'मैं हमारी कैब और यात्रा सेवाओं में मदद कर सकता हूँ - बुकिंग, किराया, गाड़ियाँ, एयरपोर्ट ट्रांसफ़र, आउटस्टेशन, घंटे वाले पैकेज और बुकिंग सहायता। बाकी के लिए कृपया कॉल या WhatsApp करें।',
    'Main hamari cab aur travel services mein madad kar sakta hoon - booking, kiraya, gaadiyan, airport transfer, outstation, hourly package aur booking support. Baaki ke liye please call ya WhatsApp kijiye.',
    'मी आमच्या कॅब आणि प्रवास सेवांबद्दल मदत करू शकतो - बुकिंग, भाडे, गाड्या, विमानतळ ट्रान्सफर, आउटस्टेशन, तासाचे पॅकेज आणि बुकिंग सहाय्य. इतर गोष्टींसाठी कृपया कॉल किंवा WhatsApp करा.',
    'Mi aamchya cab ani pravas sevanbaddal madat karu shakto - booking, bhade, gaadya, airport transfer, outstation, hourly package ani booking sahayya. Itar goshtinsathi krupaya call kinva WhatsApp kara.',
  ],
  unknown: [
    "I'm sorry, I didn't fully understand that. Are you looking for a booking, a fare, vehicle information, an airport transfer, an outstation trip, an hourly rental, or something else?",
    'माफ़ कीजिए, मैं पूरी तरह समझ नहीं पाया। क्या आपको बुकिंग, किराया, गाड़ी की जानकारी, एयरपोर्ट, आउटस्टेशन, घंटे वाला पैकेज या कुछ और चाहिए?',
    'Maaf kijiye, main poori tarah samajh nahi paaya. Kya aapko booking, kiraya, gaadi ki jaankari, airport, outstation, hourly package ya kuch aur chahiye?',
    'माफ करा, मला पूर्ण समजले नाही. तुम्हाला बुकिंग, भाडे, गाडीची माहिती, विमानतळ, आउटस्टेशन, तासाचे पॅकेज की आणखी काही हवे आहे?',
    'Maaf kara, mala purna samajla nahi. Tumhala booking, bhade, gaadichi mahiti, airport, outstation, hourly package ki ankhi kahi have aahe?',
  ],
  deny: [
    'No problem.', 'कोई बात नहीं।', 'Koi baat nahi.', 'काही हरकत नाही.', 'Kahi harkat nahi.',
  ],
  goodbye: [
    'Thanks for stopping by. Safe travels!', 'आने के लिए धन्यवाद। शुभ यात्रा!', 'Aane ke liye dhanyavad. Shubh yatra!',
    'भेट दिल्याबद्दल धन्यवाद. प्रवास सुखाचा होवो!', 'Bhet dilyabaddal dhanyavad. Pravas sukhacha hovo!',
  ],
} satisfies Record<string, Five>;

export type ReplyKey = keyof typeof TEXT;

const COMPANY_VARS: Record<string, string> = {
  phone: PHONE, wa: WA, email: COMPANY.email, address: COMPANY.address, owner: COMPANY.owner,
  company: COMPANY.name, hours: COMPANY.serviceHours, whatsapp: WA,
};

/** A sentence in the customer's language, with {placeholders} filled in. */
export function r(lang: Lang, key: ReplyKey, vars: Record<string, string | number> = {}): string {
  const row: Five = TEXT[key];
  const s = row[COL[lang]] || row[0];
  return fill(s, vars);
}

/** Fill {placeholders} - the company's own details are always available. */
export function fill(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => String(vars[k] ?? COMPANY_VARS[k] ?? m));
}

/** The quick-reply menu: what the words say, and what a tap does. */
export const MENU: { label: string; value?: string; act?: string }[] = [
  { label: 'Book a cab', value: 'I want to book a cab' },
  { label: 'Check fare', value: 'Check fare' },
  { label: 'Airport', act: 'book:AIRPORT' },
  { label: 'Local', act: 'book:LOCAL' },
  { label: 'Outstation', act: 'book:OUTSTATION' },
  { label: 'Hourly', act: 'book:HOURLY' },
  { label: 'My booking', act: 'status' },
  { label: 'Cancel a booking', value: 'I want to cancel my booking' },
  { label: 'Contact support', value: 'contact support' },
];

/** Chip words for the menus and follow-ups, in each language. */
export const CHIP_LABEL: Record<string, [hi: string, hiLatn: string, mr: string, mrLatn: string]> = {
  'Book a cab': ['कैब बुक करें', 'Cab book karein', 'कॅब बुक करा', 'Cab book kara'],
  'Check fare': ['किराया देखें', 'Kiraya dekhein', 'भाडे पाहा', 'Bhade paha'],
  Airport: ['एयरपोर्ट', 'Airport', 'विमानतळ', 'Airport'],
  Local: ['लोकल', 'Local', 'लोकल', 'Local'],
  Outstation: ['आउटस्टेशन', 'Outstation', 'आउटस्टेशन', 'Outstation'],
  Hourly: ['घंटे के हिसाब से', 'Hourly', 'तासाप्रमाणे', 'Hourly'],
  'My booking': ['मेरी बुकिंग', 'Meri booking', 'माझी बुकिंग', 'Majhi booking'],
  'Cancel a booking': ['बुकिंग रद्द करनी है', 'Booking cancel karni hai', 'बुकिंग रद्द करायची आहे', 'Booking radd karaychi aahe'],
  'Contact support': ['संपर्क करें', 'Contact karein', 'संपर्क करा', 'Samparka kara'],
  'One way': ['वन-वे', 'One-way', 'वन-वे', 'One-way'],
  Return: ['रिटर्न', 'Return', 'रिटर्न', 'Return'],
  Fare: ['किराया', 'Kiraya', 'भाडे', 'Bhade'],
  'Return fare': ['रिटर्न किराया', 'Return kiraya', 'रिटर्न भाडे', 'Return bhade'],
  'One-way fare': ['वन-वे किराया', 'One-way kiraya', 'वन-वे भाडे', 'One-way bhade'],
  'Book one way': ['वन-वे बुक करें', 'One-way book karein', 'वन-वे बुक करा', 'One-way book kara'],
  'Book return': ['रिटर्न बुक करें', 'Return book karein', 'रिटर्न बुक करा', 'Return book kara'],
  'Book this': ['यह बुक करें', 'Yeh book karein', 'हे बुक करा', 'He book kara'],
  'Book now': ['अभी बुक करें', 'Abhi book karein', 'आत्ता बुक करा', 'Atta book kara'],
  'Book as Other': ['"अन्य" के रूप में बुक करें', '"Other" mein book karein', '"इतर" म्हणून बुक करा', '"Other" mhanun book kara'],
  'Leave my details': ['मेरी जानकारी छोड़ें', 'Meri details chhodein', 'माझी माहिती द्या', 'Majhi mahiti dya'],
  'Send on WhatsApp': ['WhatsApp पर भेजें', 'WhatsApp par bhejein', 'WhatsApp वर पाठवा', 'WhatsApp var pathva'],
  'Did not get the email': ['ईमेल नहीं मिला', 'Email nahi mila', 'ईमेल आला नाही', 'Email aala nahi'],
  'Look up my booking': ['मेरी बुकिंग देखें', 'Meri booking dekhein', 'माझी बुकिंग पाहा', 'Majhi booking paha'],
};

export function chipLabel(lang: Lang, value: string): string {
  if (lang === 'en') return value;
  const row = CHIP_LABEL[value];
  return row ? row[COL[lang] - 1] : value;
}
