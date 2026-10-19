/**
 * What the website knows about each outstation route from Mumbai, in words.
 *
 * The fares are not here - they come from the Outstation fares master (see
 * ../outstation.ts) and a route without a fixed fare is quoted on request.
 * This file only carries the facts that make each route page useful to read:
 * the road you take, roughly how long it is, what people go there for, and
 * the same in Hindi and Marathi for the /hi and /mr pages.
 *
 * Distances and times are approximate road figures from central Mumbai and are
 * always written as "about"; traffic and the pickup point change them.
 *
 * Node-safe: read at build time by vite.config.ts to pre-render the pages.
 */

export interface RouteInfo {
  /** The URL key: /cabs/mumbai-to-<key>. */
  key: string;
  name: { en: string; hi: string; mr: string };
  state: string;
  km: number;
  /** "about 3 hours" style, without "about". */
  hours: { en: string; hi: string; mr: string };
  via: { en: string; hi: string; mr: string };
  /** One sentence that is true of this route and no other. */
  note: { en: string; hi: string; mr: string };
  seeThere: { en: string[]; hi: string[]; mr: string[] };
  /** Who usually books it - shapes the vehicle suggestion. */
  goodFor: string[];
  /** Matching /destinations/<slug> page, when there is one. */
  destination?: string;
  /** Has /hi and /mr pages as well. */
  localised?: boolean;
}

export const ROUTE_INFO: RouteInfo[] = [
  {
    key: 'pune', name: { en: 'Pune', hi: 'पुणे', mr: 'पुणे' }, state: 'Maharashtra', km: 150,
    hours: { en: '3 hours', hi: '3 घंटे', mr: '3 तास' },
    via: { en: 'the Mumbai–Pune Expressway', hi: 'मुंबई–पुणे एक्सप्रेसवे', mr: 'मुंबई–पुणे द्रुतगती मार्ग' },
    note: {
      en: 'The most-booked one-way route we run: office travel, Pune airport drops and students heading back to college, at any hour.',
      hi: 'यह हमारा सबसे ज़्यादा बुक होने वाला वन-वे रूट है - ऑफ़िस ट्रिप, पुणे एयरपोर्ट ड्रॉप और कॉलेज लौटते छात्र, किसी भी समय।',
      mr: 'हा आमचा सर्वाधिक बुक होणारा वन-वे मार्ग आहे - ऑफिस प्रवास, पुणे विमानतळ ड्रॉप आणि कॉलेजला परतणारे विद्यार्थी, कोणत्याही वेळी.',
    },
    seeThere: {
      en: ['Shaniwar Wada', 'Dagdusheth Ganpati', 'Aga Khan Palace', 'Sinhagad Fort'],
      hi: ['शनिवार वाड़ा', 'दगडूशेठ गणपति', 'आगा खान पैलेस', 'सिंहगढ़ किला'],
      mr: ['शनिवारवाडा', 'दगडूशेठ गणपती', 'आगाखान पॅलेस', 'सिंहगड किल्ला'],
    },
    goodFor: ['Office travel', 'Airport drops', 'Family visits'], destination: 'pune', localised: true,
  },
  {
    key: 'lonavala', name: { en: 'Lonavala', hi: 'लोनावला', mr: 'लोणावळा' }, state: 'Maharashtra', km: 83,
    hours: { en: '2 hours', hi: '2 घंटे', mr: '2 तास' },
    via: { en: 'the Mumbai–Pune Expressway', hi: 'मुंबई–पुणे एक्सप्रेसवे', mr: 'मुंबई–पुणे द्रुतगती मार्ग' },
    note: {
      en: 'Close enough for a same-day return, so many people book it as a round trip with the car waiting while they see the sights.',
      hi: 'इतना पास है कि उसी दिन लौट सकते हैं, इसलिए कई लोग राउंड ट्रिप बुक करते हैं और गाड़ी साथ रहती है।',
      mr: 'त्याच दिवशी परत येता येईल इतके जवळ, म्हणून अनेक जण राउंड ट्रिप बुक करतात आणि गाडी सोबत राहते.',
    },
    seeThere: {
      en: ['Bhushi Dam', 'Tiger Point', 'Karla Caves', 'Rajmachi viewpoint'],
      hi: ['भुशी डैम', 'टाइगर पॉइंट', 'कार्ला गुफाएँ', 'राजमाची व्यू पॉइंट'],
      mr: ['भुशी धरण', 'टायगर पॉइंट', 'कार्ला लेणी', 'राजमाची पॉइंट'],
    },
    goodFor: ['Families', 'Monsoon drives', 'Day trips'], destination: 'lonavala', localised: true,
  },
  {
    key: 'khandala', name: { en: 'Khandala', hi: 'खंडाला', mr: 'खंडाळा' }, state: 'Maharashtra', km: 80,
    hours: { en: '2 hours', hi: '2 घंटे', mr: '2 तास' },
    via: { en: 'the Mumbai–Pune Expressway', hi: 'मुंबई–पुणे एक्सप्रेसवे', mr: 'मुंबई–पुणे द्रुतगती मार्ग' },
    note: {
      en: 'On the same ghat as Lonavala but quieter; the old highway viewpoints are easiest to reach with a car that stops where you ask.',
      hi: 'लोनावला वाले घाट पर ही, पर ज़्यादा शांत।',
      mr: 'लोणावळ्याच्याच घाटात, पण अधिक शांत.',
    },
    seeThere: {
      en: ['Duke’s Nose', 'Amrutanjan Point', 'Reversing Station', 'Kune Falls'],
      hi: ['ड्यूक्स नोज़', 'अमृतांजन पॉइंट'], mr: ['ड्यूक्स नोज', 'अमृतांजन पॉइंट'],
    },
    goodFor: ['Couples', 'Short drives'], destination: 'khandala',
  },
  {
    key: 'nashik', name: { en: 'Nashik', hi: 'नासिक', mr: 'नाशिक' }, state: 'Maharashtra', km: 167,
    hours: { en: '3.5 hours', hi: '3.5 घंटे', mr: '3.5 तास' },
    via: { en: 'the Mumbai–Nashik Highway through Kasara Ghat', hi: 'कसारा घाट होते हुए मुंबई–नासिक हाईवे', mr: 'कसारा घाटातून मुंबई–नाशिक महामार्ग' },
    note: {
      en: 'Often combined with Trimbakeshwar, about 30 km further on, in a single day with the same car.',
      hi: 'अक्सर इसी गाड़ी से उसी दिन त्र्यंबकेश्वर (लगभग 30 किमी आगे) के साथ जोड़ा जाता है।',
      mr: 'बहुतेक वेळा त्याच गाडीने त्याच दिवशी त्र्यंबकेश्वर (सुमारे 30 किमी पुढे) सोबत जोडले जाते.',
    },
    seeThere: {
      en: ['Trimbakeshwar Temple', 'Panchavati and Ramkund', 'Sula Vineyards', 'Pandavleni Caves'],
      hi: ['त्र्यंबकेश्वर मंदिर', 'पंचवटी और रामकुंड', 'सुला वाइनयार्ड', 'पांडवलेणी गुफाएँ'],
      mr: ['त्र्यंबकेश्वर मंदिर', 'पंचवटी व रामकुंड', 'सुला वाईनयार्ड', 'पांडवलेणी'],
    },
    goodFor: ['Pilgrimage', 'Family trips', 'Business visits'], destination: 'nashik', localised: true,
  },
  {
    key: 'shirdi', name: { en: 'Shirdi', hi: 'शिर्डी', mr: 'शिर्डी' }, state: 'Maharashtra', km: 240,
    hours: { en: '5 hours', hi: '5 घंटे', mr: '5 तास' },
    via: { en: 'Nashik, or the Samruddhi Mahamarg', hi: 'नासिक या समृद्धि महामार्ग', mr: 'नाशिक किंवा समृद्धी महामार्ग' },
    note: {
      en: 'Most families leave Mumbai before dawn for darshan and add Shani Shingnapur, about 70 km away, before driving home.',
      hi: 'ज़्यादातर परिवार दर्शन के लिए सुबह-सुबह निकलते हैं और लौटते समय शनि शिंगणापुर (लगभग 70 किमी) भी जाते हैं।',
      mr: 'बहुतेक कुटुंबे दर्शनासाठी पहाटे निघतात आणि परतताना शनी शिंगणापूर (सुमारे 70 किमी) करतात.',
    },
    seeThere: {
      en: ['Sai Baba Samadhi Mandir', 'Dwarkamai', 'Shani Shingnapur'],
      hi: ['साईं बाबा समाधि मंदिर', 'द्वारकामाई', 'शनि शिंगणापुर'],
      mr: ['साईबाबा समाधी मंदिर', 'द्वारकामाई', 'शनी शिंगणापूर'],
    },
    goodFor: ['Pilgrimage', 'Families', 'Senior citizens'], destination: 'shirdi', localised: true,
  },
  {
    key: 'trimbakeshwar', name: { en: 'Trimbakeshwar', hi: 'त्र्यंबकेश्वर', mr: 'त्र्यंबकेश्वर' }, state: 'Maharashtra', km: 180,
    hours: { en: '4 hours', hi: '4 घंटे', mr: '4 तास' },
    via: { en: 'the Mumbai–Nashik Highway', hi: 'मुंबई–नासिक हाईवे', mr: 'मुंबई–नाशिक महामार्ग' },
    note: {
      en: 'One of the twelve Jyotirlingas, at the source of the Godavari; puja bookings start early, so most trips leave Mumbai the night before or at dawn.',
      hi: 'बारह ज्योतिर्लिंगों में से एक, गोदावरी के उद्गम पर।', mr: 'बारा ज्योतिर्लिंगांपैकी एक, गोदावरीच्या उगमाजवळ.',
    },
    seeThere: { en: ['Trimbakeshwar Jyotirlinga', 'Brahmagiri', 'Kushavarta Kund'], hi: [], mr: [] },
    goodFor: ['Pilgrimage', 'Families'],
  },
  {
    key: 'igatpuri', name: { en: 'Igatpuri', hi: 'इगतपुरी', mr: 'इगतपुरी' }, state: 'Maharashtra', km: 125,
    hours: { en: '2.5 to 3 hours', hi: '2.5 से 3 घंटे', mr: '2.5 ते 3 तास' },
    via: { en: 'the Mumbai–Nashik Highway, just past Kasara Ghat', hi: 'कसारा घाट के बाद', mr: 'कसारा घाटानंतर' },
    note: {
      en: 'Popular for monsoon weekends and for the Vipassana centre; the villa stays are spread out, so a car for the whole stay helps.',
      hi: 'मानसून वीकेंड और विपश्यना केंद्र के लिए प्रसिद्ध।', mr: 'पावसाळी वीकेंड आणि विपश्यना केंद्रासाठी प्रसिद्ध.',
    },
    seeThere: { en: ['Bhavali Dam', 'Camel Valley', 'Tringalwadi Fort', 'Dhamma Giri'], hi: [], mr: [] },
    goodFor: ['Monsoon weekends', 'Groups'], destination: 'igatpuri',
  },
  {
    key: 'mahabaleshwar', name: { en: 'Mahabaleshwar', hi: 'महाबलेश्वर', mr: 'महाबळेश्वर' }, state: 'Maharashtra', km: 265,
    hours: { en: '5.5 hours', hi: '5.5 घंटे', mr: '5.5 तास' },
    via: { en: 'the Expressway to Pune, then the Satara road and Pasarni Ghat', hi: 'पुणे एक्सप्रेसवे, फिर सातारा रोड और पसरणी घाट', mr: 'पुणे द्रुतगती मार्ग, मग सातारा रस्ता व पसरणी घाट' },
    note: {
      en: 'Usually a two- or three-night trip with Panchgani on the way; the car stays with you for the viewpoints, which are spread across the plateau.',
      hi: 'आम तौर पर 2-3 रात की ट्रिप, रास्ते में पांचगनी; व्यू पॉइंट दूर-दूर हैं इसलिए गाड़ी साथ रहती है।',
      mr: 'साधारण 2-3 रात्रींची सहल, वाटेत पाचगणी; पॉइंट्स दूरदूर असल्याने गाडी सोबत राहते.',
    },
    seeThere: {
      en: ['Venna Lake', 'Arthur’s Seat', 'Pratapgad Fort', 'Strawberry farms'],
      hi: ['वेन्ना झील', 'आर्थर सीट', 'प्रतापगढ़ किला', 'स्ट्रॉबेरी फ़ार्म'],
      mr: ['वेण्णा तलाव', 'आर्थर सीट', 'प्रतापगड किल्ला', 'स्ट्रॉबेरी मळे'],
    },
    goodFor: ['Families', 'Couples', 'Summer holidays'], destination: 'mahabaleshwar', localised: true,
  },
  {
    key: 'panchgani', name: { en: 'Panchgani', hi: 'पांचगनी', mr: 'पाचगणी' }, state: 'Maharashtra', km: 245,
    hours: { en: '5 hours', hi: '5 घंटे', mr: '5 तास' },
    via: { en: 'Pune, Wai and Pasarni Ghat', hi: 'पुणे और वाई होकर', mr: 'पुणे व वाईमार्गे' },
    note: {
      en: 'Boarding-school drop-offs and pick-ups are a regular trip here, as well as holidays combined with Mahabaleshwar, 20 km on.',
      hi: 'बोर्डिंग स्कूल ड्रॉप-पिकअप और महाबलेश्वर के साथ छुट्टियाँ।', mr: 'बोर्डिंग स्कूल ड्रॉप-पिकअप आणि महाबळेश्वरसोबत सुट्टी.',
    },
    seeThere: { en: ['Table Land', 'Sydney Point', 'Parsi Point', 'Mapro Garden'], hi: [], mr: [] },
    goodFor: ['School trips', 'Families'], destination: 'panchgani',
  },
  {
    key: 'alibaug', name: { en: 'Alibaug', hi: 'अलीबाग', mr: 'अलिबाग' }, state: 'Maharashtra', km: 95,
    hours: { en: '2.5 hours', hi: '2.5 घंटे', mr: '2.5 तास' },
    via: { en: 'Panvel and Pen', hi: 'पनवेल और पेण होकर', mr: 'पनवेल व पेणमार्गे' },
    note: {
      en: 'The road route means no ferry timings or luggage changes - door to door from your building to the beach house.',
      hi: 'सड़क से जाने पर फ़ेरी के समय या सामान बदलने की झंझट नहीं - घर से सीधे बीच हाउस तक।',
      mr: 'रस्त्याने गेल्यास फेरीच्या वेळा किंवा सामान बदलण्याची झंझट नाही - घरापासून थेट बीच हाउसपर्यंत.',
    },
    seeThere: {
      en: ['Kolaba Fort', 'Nagaon Beach', 'Kashid Beach', 'Kanakeshwar Temple'],
      hi: ['कुलाबा किला', 'नागाँव बीच', 'काशीद बीच', 'कनकेश्वर मंदिर'],
      mr: ['कुलाबा किल्ला', 'नागाव किनारा', 'काशीद किनारा', 'कनकेश्वर मंदिर'],
    },
    goodFor: ['Beach weekends', 'Groups', 'Families'], destination: 'alibaug', localised: true,
  },
  {
    key: 'kashid', name: { en: 'Kashid', hi: 'काशीद', mr: 'काशीद' }, state: 'Maharashtra', km: 125,
    hours: { en: '3.5 hours', hi: '3.5 घंटे', mr: '3.5 तास' },
    via: { en: 'Alibaug and the coastal road', hi: 'अलीबाग होकर', mr: 'अलिबागमार्गे' },
    note: {
      en: 'White-sand beach past Alibaug, usually paired with Murud-Janjira fort a little further south.',
      hi: 'अलीबाग से आगे सफ़ेद रेत वाला बीच।', mr: 'अलिबागपुढील पांढऱ्या वाळूचा किनारा.',
    },
    seeThere: { en: ['Kashid Beach', 'Murud-Janjira Fort', 'Revdanda'], hi: [], mr: [] },
    goodFor: ['Beach weekends', 'Groups'], destination: 'kashid',
  },
  {
    key: 'matheran', name: { en: 'Matheran', hi: 'माथेरान', mr: 'माथेरान' }, state: 'Maharashtra', km: 85,
    hours: { en: '2.5 hours', hi: '2.5 घंटे', mr: '2.5 तास' },
    via: { en: 'Neral, up to Dasturi Naka', hi: 'नेरल होकर दस्तूरी नाका तक', mr: 'नेरळमार्गे दस्तुरी नाक्यापर्यंत' },
    note: {
      en: 'Motor vehicles are not allowed inside Matheran, so the cab drops you at Dasturi Naka and collects you there; from there it is on foot, horse or hand-pulled rickshaw.',
      hi: 'माथेरान के अंदर गाड़ियाँ नहीं जातीं - कैब दस्तूरी नाका तक छोड़ती है और वहीं से वापस लेती है।',
      mr: 'माथेरानमध्ये वाहनांना परवानगी नाही - कॅब दस्तुरी नाक्यापर्यंत सोडते आणि तिथूनच परत घेते.',
    },
    seeThere: {
      en: ['Panorama Point', 'Charlotte Lake', 'Echo Point', 'Louisa Point'],
      hi: ['पैनोरमा पॉइंट', 'शार्लोट लेक', 'इको पॉइंट', 'लुईसा पॉइंट'],
      mr: ['पॅनोरमा पॉइंट', 'शार्लोट तलाव', 'इको पॉइंट', 'लुईसा पॉइंट'],
    },
    goodFor: ['Day trips', 'Families', 'Couples'], destination: 'matheran', localised: true,
  },
  {
    key: 'goa', name: { en: 'Goa', hi: 'गोवा', mr: 'गोवा' }, state: 'Goa', km: 590,
    hours: { en: '11 hours', hi: '11 घंटे', mr: '11 तास' },
    via: { en: 'the Mumbai–Goa Highway (NH66) along the Konkan, or via Pune and Kolhapur', hi: 'कोंकण के रास्ते मुंबई–गोवा हाईवे (NH66), या पुणे–कोल्हापुर होकर', mr: 'कोकणातून मुंबई–गोवा महामार्ग (NH66), किंवा पुणे–कोल्हापूरमार्गे' },
    note: {
      en: 'A full day on the road, so we plan the start time, meal stops and the driver’s rest; the Goa entry permit and tolls are shown on the quote.',
      hi: 'पूरे दिन का सफ़र है - निकलने का समय, खाने के स्टॉप और ड्राइवर का आराम पहले से तय होता है; गोवा परमिट और टोल कोटेशन में दिखते हैं।',
      mr: 'पूर्ण दिवसाचा प्रवास - निघण्याची वेळ, जेवणाचे थांबे आणि चालकाची विश्रांती आधीच ठरवली जाते; गोवा परमिट व टोल कोटेशनमध्ये दाखवले जातात.',
    },
    seeThere: {
      en: ['Calangute and Baga', 'Old Goa churches', 'Fort Aguada', 'Palolem'],
      hi: ['कलंगूट और बागा', 'ओल्ड गोवा चर्च', 'फ़ोर्ट अगुआडा', 'पालोलेम'],
      mr: ['कलंगुट व बागा', 'जुने गोवे चर्च', 'आग्वाद किल्ला', 'पाळोळे'],
    },
    goodFor: ['Holidays', 'Groups', 'Relocation'], destination: 'goa', localised: true,
  },
  {
    key: 'kolhapur', name: { en: 'Kolhapur', hi: 'कोल्हापुर', mr: 'कोल्हापूर' }, state: 'Maharashtra', km: 375,
    hours: { en: '7 hours', hi: '7 घंटे', mr: '7 तास' },
    via: { en: 'Pune and the Pune–Bangalore Highway (NH48)', hi: 'पुणे और NH48 होकर', mr: 'पुणे व NH48 मार्गे' },
    note: {
      en: 'Most trips are for Mahalaxmi (Ambabai) darshan, often with Jyotiba and Narsobawadi on the same visit.',
      hi: 'ज़्यादातर यात्राएँ महालक्ष्मी (अंबाबाई) दर्शन के लिए।', mr: 'बहुतेक प्रवास महालक्ष्मी (अंबाबाई) दर्शनासाठी.',
    },
    seeThere: { en: ['Mahalaxmi Temple', 'Jyotiba Temple', 'Rankala Lake', 'Panhala Fort'], hi: [], mr: [] },
    goodFor: ['Pilgrimage', 'Family visits'],
  },
  {
    key: 'aurangabad', name: { en: 'Chhatrapati Sambhajinagar (Aurangabad)', hi: 'छत्रपति संभाजीनगर', mr: 'छत्रपती संभाजीनगर' }, state: 'Maharashtra', km: 335,
    hours: { en: '6 to 7 hours', hi: '6 से 7 घंटे', mr: '6 ते 7 तास' },
    via: { en: 'the Samruddhi Mahamarg', hi: 'समृद्धि महामार्ग', mr: 'समृद्धी महामार्ग' },
    note: {
      en: 'The base for Ajanta and Ellora; a multi-day booking keeps the same car and driver for the cave sites, which are far apart.',
      hi: 'अजंता-एलोरा के लिए बेस।', mr: 'अजिंठा-वेरूळसाठी मुख्य ठिकाण.',
    },
    seeThere: { en: ['Ellora Caves', 'Ajanta Caves', 'Grishneshwar Temple', 'Bibi Ka Maqbara', 'Daulatabad Fort'], hi: [], mr: [] },
    goodFor: ['Heritage tours', 'Pilgrimage', 'Business visits'],
  },
  {
    key: 'bhimashankar', name: { en: 'Bhimashankar', hi: 'भीमाशंकर', mr: 'भीमाशंकर' }, state: 'Maharashtra', km: 215,
    hours: { en: '5 hours', hi: '5 घंटे', mr: '5 तास' },
    via: { en: 'Pune and Manchar', hi: 'पुणे होकर', mr: 'पुणेमार्गे' },
    note: {
      en: 'A Jyotirlinga temple in a wildlife sanctuary in the Sahyadris; the last stretch is a hill road, so we send drivers who know it, especially in the monsoon.',
      hi: 'सह्याद्रि में ज्योतिर्लिंग मंदिर।', mr: 'सह्याद्रीतील ज्योतिर्लिंग मंदिर.',
    },
    seeThere: { en: ['Bhimashankar Jyotirlinga', 'Bhimashankar Wildlife Sanctuary', 'Hanuman Lake'], hi: [], mr: [] },
    goodFor: ['Pilgrimage', 'Monsoon trips'],
  },
  {
    key: 'surat', name: { en: 'Surat', hi: 'सूरत', mr: 'सुरत' }, state: 'Gujarat', km: 285,
    hours: { en: '5 hours', hi: '5 घंटे', mr: '5 तास' },
    via: { en: 'the Mumbai–Ahmedabad Highway (NH48)', hi: 'मुंबई–अहमदाबाद हाईवे (NH48)', mr: 'मुंबई–अहमदाबाद महामार्ग (NH48)' },
    note: {
      en: 'Mostly business travel to the diamond and textile markets; the Gujarat permit is shown separately on the quote.',
      hi: 'ज़्यादातर हीरा और कपड़ा बाज़ार के लिए बिज़नेस ट्रिप; गुजरात परमिट कोटेशन में अलग दिखता है।',
      mr: 'बहुतेक हिरे व कापड बाजारासाठी व्यावसायिक प्रवास; गुजरात परमिट कोटेशनमध्ये वेगळे दाखवले जाते.',
    },
    seeThere: { en: ['Dumas Beach', 'Surat Castle', 'Textile and diamond markets'], hi: [], mr: [] },
    goodFor: ['Business travel', 'Family visits'],
  },
  {
    key: 'ahmedabad', name: { en: 'Ahmedabad', hi: 'अहमदाबाद', mr: 'अहमदाबाद' }, state: 'Gujarat', km: 530,
    hours: { en: '9 to 10 hours', hi: '9 से 10 घंटे', mr: '9 ते 10 तास' },
    via: { en: 'the Mumbai–Ahmedabad Highway (NH48) through Surat and Vadodara', hi: 'सूरत और वडोदरा होकर NH48', mr: 'सुरत व वडोदरामार्गे NH48' },
    note: {
      en: 'A long single-day drive; we plan rest stops and show the Gujarat permit and driver allowance on the quote.',
      hi: 'एक दिन का लंबा सफ़र।', mr: 'एका दिवसाचा लांब प्रवास.',
    },
    seeThere: { en: ['Sabarmati Ashram', 'Adalaj Stepwell', 'Sabarmati Riverfront'], hi: [], mr: [] },
    goodFor: ['Business travel', 'Relocation'],
  },
  {
    key: 'daman', name: { en: 'Daman', hi: 'दमन', mr: 'दमण' }, state: 'Dadra and Nagar Haveli and Daman and Diu', km: 175,
    hours: { en: '4 hours', hi: '4 घंटे', mr: '4 तास' },
    via: { en: 'the Mumbai–Ahmedabad Highway (NH48)', hi: 'NH48', mr: 'NH48' },
    note: {
      en: 'A short coastal weekend north of Mumbai; the Union Territory entry tax, where charged, is billed at actuals.',
      hi: 'मुंबई के उत्तर में छोटा तटीय वीकेंड।', mr: 'मुंबईच्या उत्तरेकडील छोटा किनारी वीकेंड.',
    },
    seeThere: { en: ['Devka Beach', 'Moti Daman Fort', 'Jampore Beach'], hi: [], mr: [] },
    goodFor: ['Weekend trips', 'Groups'],
  },
  {
    key: 'ganpatipule', name: { en: 'Ganpatipule', hi: 'गणपतिपुले', mr: 'गणपतीपुळे' }, state: 'Maharashtra', km: 330,
    hours: { en: '7 hours', hi: '7 घंटे', mr: '7 तास' },
    via: { en: 'the Mumbai–Goa Highway (NH66) and Ratnagiri', hi: 'NH66 और रत्नागिरी होकर', mr: 'NH66 व रत्नागिरीमार्गे' },
    note: {
      en: 'The beach-side Swayambhu Ganpati temple on the Konkan coast, usually a two-night trip with Ratnagiri.',
      hi: 'कोंकण तट पर समुद्र किनारे स्वयंभू गणपति मंदिर।', mr: 'कोकण किनाऱ्यावरील स्वयंभू गणपती मंदिर.',
    },
    seeThere: { en: ['Swayambhu Ganpati Temple', 'Ganpatipule Beach', 'Ratnagiri', 'Jaigad Fort'], hi: [], mr: [] },
    goodFor: ['Pilgrimage', 'Konkan holidays'],
  },
];

export const routeInfo = (key: string) => ROUTE_INFO.find((r) => r.key === key);

/** /cabs/mumbai-to-<key> */
export const enRoutePath = (key: string) => `/cabs/mumbai-to-${key}`;
/** /hi/mumbai-se-<key>-cab - "Mumbai se Nashik cab", as people type it. */
export const hiRoutePath = (key: string) => `/hi/mumbai-se-${key}-cab`;
/** /mr/mumbai-te-<key>-taxi - "Mumbai te Nashik taxi", as people type it. */
export const mrRoutePath = (key: string) => `/mr/mumbai-te-${key}-taxi`;
