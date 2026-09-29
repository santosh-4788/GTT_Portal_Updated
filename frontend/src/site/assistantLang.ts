/**
 * English, Hindi and Marathi for the site assistant - without a translation
 * service.
 *
 * The assistant is a set of rules over this portal's own data (see
 * assistantKnowledge.ts), and that is what keeps it free to run. Sending every
 * message to a paid translation or AI API would undo that, so this file does
 * the two things the booking conversation actually needs, locally:
 *
 *   1. Understand. `detectLang` tells English, Hindi and Marathi apart - in
 *      Devanagari or typed in Roman letters, and mixed with English the way
 *      people really write ("Mujhe Mumbai se Pune one-way cab book karni hai").
 *      `normalise` then rewrites the words the booking flow cares about into
 *      the English the parser already reads: cities, "ek taraf" -> one way,
 *      "wapas / parat" -> return, "kal / udya" -> tomorrow, "sham 5 baje" ->
 *      5:00 pm, "Mumbai se Pune" / "Mumbai te Pune" -> from Mumbai to Pune.
 *
 *   2. Answer. Every question and message the booking conversation says is
 *      written out below in five forms - English, Hindi, Hinglish, Marathi and
 *      Marathi in Roman letters - so a customer who writes Hinglish is answered
 *      in Hinglish, and one who writes Devanagari is answered in Devanagari.
 *
 * What it does not do: the knowledge-base answers (rates, policies, FAQs) are
 * still written in English, and are introduced with a one-line note in the
 * customer's language rather than machine-translated.
 */

export type Lang = 'en' | 'hi' | 'hi-Latn' | 'mr' | 'mr-Latn';

/* ==========================================================================
   Detecting the language
   ========================================================================== */

const DEVANAGARI = /[ऀ-ॿ]/;

/** Words that only (or almost only) turn up in one language. */
const HI_DEVA = ['है', 'हैं', 'मुझे', 'मैं', 'चाहिए', 'चाहिये', 'करनी', 'करना', 'करवानी', 'से', 'तक', 'कल', 'नहीं', 'कितना', 'कितने', 'क्या', 'हमें', 'जाना', 'वापस', 'वापसी', 'और', 'भी', 'के', 'लिए', 'का', 'की', 'गाड़ी', 'बजे', 'आना', 'कैसे', 'कहाँ', 'शुक्रिया', 'आप'];
const MR_DEVA = ['आहे', 'आहेत', 'मला', 'मी', 'पाहिजे', 'हवी', 'हवे', 'हवा', 'करायची', 'करायचे', 'करायचा', 'कडे', 'पासून', 'पर्यंत', 'उद्या', 'नको', 'नाही', 'किती', 'काय', 'जायचे', 'जायचं', 'आम्ही', 'आम्हाला', 'माझे', 'माझा', 'माझी', 'परत', 'ते', 'आणि', 'वाजता', 'तुम्ही', 'कसे', 'कुठे', 'गाडी', 'भाडे', 'साठी', 'होय'];
const HI_LATN = ['mujhe', 'muje', 'mujhko', 'mereko', 'hai', 'hain', 'chahiye', 'chaiye', 'chahie', 'karni', 'karna', 'karwani', 'karvani', 'karwana', 'se', 'tak', 'kal', 'nahi', 'nahin', 'kitna', 'kitne', 'kitni', 'kya', 'humein', 'hume', 'humko', 'hamein', 'jana', 'jaana', 'wapas', 'vapas', 'wapsi', 'vapsi', 'aur', 'bhi', 'mera', 'meri', 'mere', 'kiraya', 'kiraaya', 'bhaiya', 'dijiye', 'batao', 'bataiye', 'kab', 'kahan', 'taraf', 'tarfa', 'subah', 'shaam', 'sham', 'raat', 'dopahar', 'baje', 'liye', 'abhi', 'parso', 'aana', 'chalega', 'milegi', 'milega', 'hoga', 'kaise', 'aap', 'shukriya', 'namaste', 'ji', 'dhanyawad', 'paise', 'lagenge', 'padega', 'bhejo', 'batao', 'kaunsi', 'gaadi'];
const MR_LATN = ['mala', 'amhala', 'aamhala', 'aahe', 'ahe', 'aahet', 'pahije', 'pahijet', 'havi', 'hava', 'karaychi', 'karaychay', 'karayche', 'karaycha', 'jaycha', 'jaaycha', 'jayche', 'jaychay', 'pasun', 'paasun', 'varun', 'paryant', 'udya', 'udyaa', 'nako', 'kiti', 'kay', 'kaay', 'parat', 'amhi', 'aamhi', 'majha', 'maza', 'mazi', 'majhi', 'tumhi', 'sakali', 'sandhyakali', 'ratri', 'vajta', 'vajata', 'lok', 'bhade', 'bhada', 'mhanje', 'ani', 'sathi', 'saathi', 'kadhi', 'kuthe', 'yaycha', 'hoy', 'punyala', 'mumbaila', 'mumbaihun', 'te', 'kasa', 'kase', 'dya', 'sanga', 'namaskar', 'kitila', 'pathva', 'konti'];
const EN = ['i', 'want', 'need', 'book', 'the', 'please', 'what', 'how', 'is', 'are', 'my', 'from', 'to', 'for', 'would', 'like', 'can', 'you', 'much', 'cost', 'price', 'tomorrow', 'today', 'people', 'hello', 'thanks', 'thank'];

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
const score = (ws: string[], list: string[]) => ws.reduce((n, w) => n + (list.includes(w) ? 1 : 0), 0);

/**
 * The language a message is written in, or null when it gives no real signal
 * - a number, an address, a name - so the conversation keeps the language it
 * already has.
 */
export function detectLang(raw: string): Lang | null {
  const ws = words(raw);
  if (!ws.length) return null;

  if (DEVANAGARI.test(raw)) {
    const hi = score(ws, HI_DEVA);
    const mr = score(ws, MR_DEVA);
    return mr > hi ? 'mr' : 'hi';
  }

  const hi = score(ws, HI_LATN);
  const mr = score(ws, MR_LATN);
  const en = score(ws, EN);
  if (hi === 0 && mr === 0) return en >= 2 ? 'en' : null;
  // A stray word ("log in", "kay") in an otherwise English sentence.
  if (en > 2 * (hi + mr)) return 'en';
  if (mr > hi) return 'mr-Latn';
  if (hi > mr) return 'hi-Latn';
  // A tie: Marathi's giveaway endings, else Hindi (the commoner of the two).
  return /\b\w+(aycha|ayche|aychi|aahe)\b/.test(raw.toLowerCase()) ? 'mr-Latn' : 'hi-Latn';
}

/* ==========================================================================
   Normalising what was typed into the English the parser reads
   ========================================================================== */

const DEVA_DIGITS = '०१२३४५६७८९';

/** Place names: [Devanagari, Devanagari oblique stem, Roman oblique stem, English]. */
const PLACES: [string, string, string, string][] = [
  ['मुंबई', 'मुंबई', 'mumbai', 'mumbai'],
  ['पुणे', 'पुण्या', 'punya', 'pune'],
  ['नाशिक', 'नाशिक', 'nashik', 'nashik'],
  ['शिर्डी', 'शिर्डी', 'shirdi', 'shirdi'],
  ['लोणावळा', 'लोणावळ्या', 'lonavlya', 'lonavala'],
  ['महाबळेश्वर', 'महाबळेश्वर', 'mahabaleshwar', 'mahabaleshwar'],
  ['गोवा', 'गोव्या', 'govya', 'goa'],
  ['अलिबाग', 'अलिबाग', 'alibag', 'alibag'],
  ['ठाणे', 'ठाण्या', 'thanya', 'thane'],
  ['कोल्हापूर', 'कोल्हापूर', 'kolhapur', 'kolhapur'],
  ['सातारा', 'साताऱ्या', 'satarya', 'satara'],
  ['नागपूर', 'नागपूर', 'nagpur', 'nagpur'],
  ['औरंगाबाद', 'औरंगाबाद', 'aurangabad', 'aurangabad'],
  ['माथेरान', 'माथेरान', 'matheran', 'matheran'],
  ['इगतपुरी', 'इगतपुरी', 'igatpuri', 'igatpuri'],
  ['रत्नागिरी', 'रत्नागिरी', 'ratnagiri', 'ratnagiri'],
];

/** Every place the language rules know, in English - for the fuzzy matcher. */
export const KNOWN_PLACES = PLACES.map((p) => p[3]);

/** Single words, either script. Hindi and Marathi spellings side by side. */
const WORD: Record<string, string> = {
  // people and wanting
  'मुझे': 'i', 'मैं': 'i', 'मला': 'i', 'मी': 'i', 'हमें': 'we', 'हम': 'we', 'आम्हाला': 'we', 'आम्ही': 'we',
  mujhe: 'i', muje: 'i', mujhko: 'i', mereko: 'i', mala: 'i', malaa: 'i',
  hume: 'we', humein: 'we', humko: 'we', hamein: 'we', amhala: 'we', aamhala: 'we', amhi: 'we', aamhi: 'we',
  'चाहिए': 'want', 'चाहिये': 'want', 'पाहिजे': 'want', 'हवी': 'want', 'हवे': 'want', 'हवा': 'want',
  chahiye: 'want', chaiye: 'want', chahie: 'want', pahije: 'want', pahijet: 'want', havi: 'want', hava: 'want',
  // the vehicle
  'कैब': 'cab', 'कॅब': 'cab', 'टैक्सी': 'taxi', 'टॅक्सी': 'taxi', 'गाड़ी': 'car', 'गाडी': 'car', 'कार': 'car',
  gaadi: 'car', gadi: 'car', gaddi: 'car', 'बुक': 'book', 'बुकिंग': 'booking',
  'सेडान': 'sedan', 'इनोवा': 'innova', 'एसयूवी': 'suv', 'टेम्पो': 'tempo',
  // the airport
  'एयरपोर्ट': 'airport', 'एअरपोर्ट': 'airport', 'विमानतळ': 'airport', 'विमानतळावर': 'airport',
  'विमानतळावरून': 'from airport', 'विमानतळाहून': 'from airport', vimantal: 'airport', vimantalavar: 'airport',
  vimantalavarun: 'from airport', 'टर्मिनल': 'terminal', 'फ्लाइट': 'flight', 'फ़्लाइट': 'flight', 'विमान': 'flight',
  // kind of trip
  'रिटर्न': 'return', 'वापसी': 'return', 'वापस': 'return', 'परत': 'return', 'परतीचा': 'return',
  wapas: 'return', vapas: 'return', wapis: 'return', wapsi: 'return', vapsi: 'return', parat: 'return',
  'लोकल': 'local', 'आउटस्टेशन': 'outstation', 'घंटे': 'hours', 'घंटा': 'hours', 'तास': 'hours', ghante: 'hours', taas: 'hours',
  // when
  'आज': 'today', aaj: 'today', aj: 'today', 'कल': 'tomorrow', kal: 'tomorrow', 'उद्या': 'tomorrow', udya: 'tomorrow', udyaa: 'tomorrow',
  'सुबह': 'morning', 'सकाळी': 'morning', subah: 'morning', subha: 'morning', sakali: 'morning', sakaali: 'morning',
  'शाम': 'evening', 'संध्याकाळी': 'evening', sham: 'evening', shaam: 'evening', sandhyakali: 'evening',
  'रात': 'night', 'रात्री': 'night', raat: 'night', ratri: 'night',
  'दोपहर': 'afternoon', 'दुपारी': 'afternoon', dopahar: 'afternoon', dupari: 'afternoon',
  'बजे': 'oclock', 'वाजता': 'oclock', 'वाजे': 'oclock', baje: 'oclock', vajta: 'oclock', vajata: 'oclock', vaje: 'oclock',
  // who
  'लोग': 'people', 'लोक': 'people', 'जण': 'people', 'जणं': 'people', 'यात्री': 'passengers', 'प्रवासी': 'passengers',
  // Not "jan" - that is January in "15 jan" - nor "rat".
  log: 'people', logon: 'people', lok: 'people',
  // money and questions
  'किराया': 'fare', 'भाडे': 'fare', 'भाडं': 'fare', kiraya: 'fare', kiraaya: 'fare', bhada: 'fare', bhade: 'fare', bhaada: 'fare',
  'कितना': 'how much', 'कितने': 'how many', 'किती': 'how much', kitna: 'how much', kitne: 'how many', kitni: 'how much', kiti: 'how much',
  'क्या': 'what', 'काय': 'what', kya: 'what', kay: 'what', kaay: 'what',
  // yes, no, cancel
  'हाँ': 'yes', 'हां': 'yes', 'होय': 'yes', haan: 'yes', haa: 'yes', han: 'yes', hoy: 'yes',
  'नहीं': 'no', 'नही': 'no', 'नाही': 'no', 'नको': 'no', nahi: 'no', nahin: 'no', nai: 'no', nako: 'no',
  'रद्द': 'cancel', 'कैंसल': 'cancel', 'कॅन्सल': 'cancel', radd: 'cancel',
  // going and coming
  'जाना': 'go', 'जायचे': 'go', 'जायचं': 'go', 'जायचा': 'go', jana: 'go', jaana: 'go', jaycha: 'go', jaaycha: 'go', jayche: 'go', jaychay: 'go',
  'आना': 'come', 'यायचे': 'come', 'यायचा': 'come', aana: 'come', aane: 'come', yaycha: 'come', yayche: 'come',
  // connectors the route reader looks for
  'से': 'se', 'तक': 'tak', 'ते': 'te', 'पासून': 'pasun', 'वरून': 'varun', 'पर्यंत': 'paryant',
  paasun: 'pasun', paryent: 'paryant', 'के': 'ke', 'लिए': 'liye', 'और': 'and', 'आणि': 'and', ani: 'and', aur: 'and',
  'ईमेल': 'email', 'ई-मेल': 'email', 'कुछ': 'anything', kuch: 'anything', 'काही': 'anything', kahi: 'anything',
  'आणखी': 'else', ankhi: 'else', aankhi: 'else',
  'कृपया': 'please', krupaya: 'please', 'नमस्ते': 'hello', 'नमस्कार': 'hello', namaste: 'hello', namaskar: 'hello',
  'धन्यवाद': 'thanks', 'शुक्रिया': 'thanks', dhanyavad: 'thanks', dhanyawad: 'thanks', shukriya: 'thanks',
  // money: "kitne paise lagenge", "kitna padega", "कितीला येईल"
  paise: 'fare', paisa: 'fare', 'पैसे': 'fare', 'पैसा': 'fare', 'भाड़ा': 'fare', 'रेट': 'rate', 'फेयर': 'fare',
  padega: 'cost', padegi: 'cost', padenge: 'cost', lagega: 'cost', lagegi: 'cost', lagenge: 'cost', lagta: 'cost', lagti: 'cost',
  'पड़ेगा': 'cost', 'पड़ेगी': 'cost', 'लगेगा': 'cost', 'लगेगी': 'cost', 'लगेंगे': 'cost', 'लागेल': 'cost', 'लागतील': 'cost',
  kitila: 'how much', kitilaa: 'how much', 'कितीला': 'how much', 'चार्ज': 'charge', 'एक्स्ट्रा': 'extra', 'टोल': 'toll',
  batao: 'tell', bataiye: 'tell', bataye: 'tell', batana: 'tell', sanga: 'tell', 'बताइए': 'tell', 'बताओ': 'tell', 'सांगा': 'tell',
  // is it there?
  milegi: 'available', milega: 'available', milti: 'available', milta: 'available', milte: 'available', milel: 'available',
 'मिलेगी': 'available', 'मिलेगा': 'available', 'मिलती': 'available', 'मिळेल': 'available', 'मिळते': 'available',
  'उपलब्ध': 'available', upalabdh: 'available',
  // which / who / where
  kaunsi: 'which', konsi: 'which', kaunse: 'which', kaunsa: 'which', konti: 'which', kontya: 'which',
  'कौनसी': 'which', 'कौन-सी': 'which', 'कौनसा': 'which', 'कोणती': 'which', 'कोणत्या': 'which', 'कोणता': 'which',
  kaun: 'who', kon: 'who', 'कौन': 'who', 'कोण': 'who',
  kaha: 'where', kahan: 'where', kidhar: 'where', kuthe: 'where', 'कहाँ': 'where', 'कहां': 'where', 'कुठे': 'where',
  // an existing booking
  'ड्राइवर': 'driver', 'ड्रायव्हर': 'driver', 'ड्राईवर': 'driver', 'चालक': 'driver', chalak: 'driver',
  'स्टेटस': 'status', 'कन्फर्म': 'confirm', 'पक्की': 'confirmed', 'बदलना': 'change', 'बदलनी': 'change', 'बदलायची': 'change',
  'बदलायचे': 'change', badalna: 'change', badalni: 'change', badlani: 'change', badalvaychi: 'change', badlaychi: 'change',
  'शिकायत': 'complaint', 'तक्रार': 'complaint', shikayat: 'complaint', takrar: 'complaint',
  'फीडबैक': 'feedback', 'फीडबॅक': 'feedback', 'रेटिंग': 'rating', 'सुझाव': 'suggestion', 'सूचना': 'suggestion', sujhav: 'suggestion',
  // money and papers
  'भुगतान': 'payment', 'पेमेंट': 'payment', 'बिल': 'bill', 'रसीद': 'receipt', 'पावती': 'receipt', 'इनवॉइस': 'invoice',
  // talking to us
  'मदद': 'help', 'मदत': 'help', madad: 'help', madat: 'help', 'नंबर': 'number', 'संपर्क': 'contact',
  'सेवा': 'service', 'सर्विस': 'service', seva: 'service', 'ऑनलाइन': 'online', 'व्हाट्सएप': 'whatsapp', 'व्हॉट्सअॅप': 'whatsapp',
  'यात्रा': 'trip', 'प्रवास': 'trip', 'गाड़ियाँ': 'cars', 'गाड्या': 'cars', gaadiyan: 'cars', gadya: 'cars',
};

// Every place name, plain and with the Marathi case endings ("Punyala" = to
// Pune, "Mumbaihun" = from Mumbai), in both scripts.
for (const [deva, stem, roman, en] of PLACES) {
  WORD[deva] = en;
  WORD[en] = en;
  for (const s of ['ला', 'साठी', 'कडे']) WORD[`${stem}${s}`] = `to ${en}`;
  for (const s of ['हून', 'वरून', 'पासून']) WORD[`${stem}${s}`] = `from ${en}`;
  for (const s of ['la', 'sathi', 'kade']) WORD[`${roman}${s}`] = `to ${en}`;
  for (const s of ['hun', 'varun', 'pasun']) WORD[`${roman}${s}`] = `from ${en}`;
}
Object.assign(WORD, {
  'पुणा': 'pune', 'लोनावला': 'lonavala', 'महाबलेश्वर': 'mahabaleshwar', 'नागपुर': 'nagpur', 'ठाणा': 'thane',
  'पनवेल': 'panvel', 'अंधेरी': 'andheri', 'बांद्रा': 'bandra', 'वांद्रे': 'bandra', 'पवई': 'powai', 'दादर': 'dadar',
  'बोरीवली': 'borivali', 'कल्याण': 'kalyan', 'वाशी': 'vashi', 'डोंबिवली': 'dombivli', 'सूरत': 'surat',
  'वापी': 'vapi', 'अहमदाबाद': 'ahmedabad', 'बॉम्बे': 'mumbai', 'बंबई': 'mumbai',
  // Marathi case endings on the words the rules key on.
  'एअरपोर्टवरून': 'from airport', 'एयरपोर्टवरून': 'from airport', 'एअरपोर्टहून': 'from airport', 'एयरपोर्टसे': 'from airport',
  'एअरपोर्टला': 'to airport', 'एयरपोर्टला': 'to airport', 'विमानतळाला': 'to airport', 'एअरपोर्टवर': 'airport',
  'ड्रायव्हरला': 'driver', 'ड्राइवरला': 'driver', 'चालकाला': 'driver', 'ड्रायव्हरची': 'driver', 'ड्राइवरची': 'driver', 'ड्रायव्हरचे': 'driver',
  'परतीची': 'return', 'परतीचे': 'return', 'परतीच्या': 'return', 'तासांसाठी': 'hours', 'तासासाठी': 'hours', 'तासांची': 'hours', 'घंटों': 'hours',
  'घर': 'home', 'घरी': 'home', 'घरून': 'from home', ghar: 'home', ghari: 'home', gharun: 'from home', 'को': 'ko',
});

/** Phrases, matched before the words. Order matters: longest first. */
const PHRASES: [RegExp, string][] = [
  [/एक\s*तरफ़ा|एक\s*तरफा|एकतर्फी|एकतर्फा|वन[\s-]?वे|\bek\s*taraf(?:a|i)?\b|\bektarf[ai]\b|\bek\s*tarf[ai]\b|\bekatarf[ai]\b/g, 'one way'],
  [/आना[\s-]*जाना|जाना[\s-]*आना|येणे[\s-]*जाणे|जाऊन[\s-]*येऊन|येऊन[\s-]*जाऊन|राउंड\s*ट्रिप|\baa?na[\s-]*jaa?na\b|\bjaa?na[\s-]*aa?na\b|\bjaun[\s-]*yeun\b|\byeun[\s-]*jaun\b/g, 'return'],
  [/हवाई\s*अड्ड[ाे]|\bhawai\s*adde?a?\b|\bhavai\s*adda\b/g, 'airport'],
  [/बुक\s*(?:करनी|करना|करवानी|करवाना)\s*है|बुक\s*करायच[ीेा]\s*आहे|बुक\s*करायचं\s*आहे/g, 'i want to book'],
  [/\bbook\s*(?:karni|karna|karvani|karwani|karwana|karvana)\s*(?:hai|he)\b|\bbook\s*karaych(?:i|e|a|ay)(?:\s*(?:aahe|ahe))?\b/g, 'i want to book'],
  [/परसों|परवा|\bparso[n]?\b|\bparva\b/g, 'day after tomorrow'],
  // "kitne ki hai", "kitne mein padegi" ask a price, not a number.
  [/कितने\s*(?:का|की|के|में)|\bkitne\s+(?:ka|ki|ke|mein|me|main)\b|\bkitne\s+paise\b/g, 'how much'],
];

/** Words that end a place name when the route reader walks along a sentence. */
const STOP = new Set([
  'i', 'we', 'me', 'my', 'want', 'need', 'book', 'booking', 'cab', 'car', 'taxi', 'a', 'an', 'the', 'one', 'way',
  'one-way', 'oneway', 'return', 'for', 'to', 'from', 'and', 'please', 'today', 'tomorrow', 'go', 'come', 'people',
  'passengers', 'at', 'on', 'in', 'is', 'hai', 'hain', 'aahe', 'ahe', 'karni', 'karna', 'ke', 'ki', 'ka', 'liye',
  'tak', 'paryant', 'la', 'kade', 'sathi', 'se', 'te', 'pasun', 'varun', 'oclock', 'morning', 'evening', 'night',
  'afternoon', 'yes', 'no', 'what', 'how', 'much', 'many', 'fare', 'cab-book', 'jaana', 'hoga', 'drop', 'pickup',
]);

/** "X se Y", "X te Y", "X pasun Y" -> "from X to Y". */
function readRoute(tokens: string[]): string[] {
  const at = tokens.findIndex((t) => t === 'se' || t === 'te' || t === 'pasun' || t === 'varun');
  if (at <= 0) return tokens;
  let a = at - 1;
  while (a - 1 >= 0 && at - a < 3 && !STOP.has(tokens[a - 1]) && !/^\d/.test(tokens[a - 1])) a -= 1;
  if (STOP.has(tokens[at - 1])) return tokens;
  let b = at + 1;
  if (b >= tokens.length || STOP.has(tokens[b]) || /^\d/.test(tokens[b])) {
    // "airport se" with nothing after it still says where the car starts.
    return [...tokens.slice(0, a), 'from', ...tokens.slice(a, at), ...tokens.slice(at + 1)];
  }
  while (b + 1 < tokens.length && b - at < 2 && !STOP.has(tokens[b + 1]) && !/^\d/.test(tokens[b + 1])) b += 1;
  return [...tokens.slice(0, a), 'from', ...tokens.slice(a, at), 'to', ...tokens.slice(at + 1, b + 1), ...tokens.slice(b + 1)];
}

/** "evening 5 oclock", "5 oclock evening", "night 11" -> "5:00 pm" / "11:00 pm". */
function readTimes(s: string): string {
  const ampm = (part: string, h: number) =>
    part === 'morning' ? (h === 12 ? 'pm' : 'am')
      : part === 'night' ? (h <= 4 || h === 12 ? 'am' : 'pm')
        : 'pm';
  const fmt = (h: string, m: string | undefined, part: string) => `${Number(h)}:${m ?? '00'} ${ampm(part, Number(h))}`;
  return s
    .replace(/\b(morning|evening|night|afternoon)\s+(?:ko\s+)?(\d{1,2})(?:[:.](\d{2}))?(?:\s*oclock)?\b/g, (_, p, h, m) => fmt(h, m, p))
    .replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*oclock\s+(?:ko\s+)?(morning|evening|night|afternoon)\b/g, (_, h, m, p) => fmt(h, m, p))
    .replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*oclock\b/g, (_, h, m) => `${Number(h)}:${m ?? '00'}`);
}

/**
 * The message in the English the booking parser reads. Harmless on English:
 * the words it rewrites are not English words.
 */
export function normalise(raw: string): string {
  let s = raw.toLowerCase()
    .replace(/[०-९]/g, (d) => String(DEVA_DIGITS.indexOf(d)))
    .replace(/[।॥,!?;"“”'‘’()]/g, ' ')
    .replace(/\.+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, to] of PHRASES) s = s.replace(re, ` ${to} `);
  const tokens = s.split(/\s+/).filter(Boolean).flatMap((t) => (WORD[t] ?? t).split(' '));
  return readTimes(readRoute(tokens).join(' ')).replace(/\s+/g, ' ').trim();
}

/* ==========================================================================
   What the assistant says
   ========================================================================== */

type Five = [en: string, hi: string, hiLatn: string, mr: string, mrLatn: string];
const COL: Record<Lang, number> = { en: 0, hi: 1, 'hi-Latn': 2, mr: 3, 'mr-Latn': 4 };

const TEXT = {
  'route.pair': [' from {from} to {to}', '{from} से {to} के लिए ', '{from} se {to} ke liye ', '{from} ते {to} ', '{from} te {to} '],
  'route.to': [' to {to}', '{to} के लिए ', '{to} ke liye ', '{to}साठी ', '{to} sathi '],
  'ack.oneWay': [
    "Sure. Let's book your one-way cab{route}. I'll show one-way fares only.",
    'बिल्कुल। {route}वन-वे कैब बुक करते हैं। मैं सिर्फ़ वन-वे किराया दिखाऊँगा।',
    'Bilkul. {route}one-way cab book karte hain. Main sirf one-way kiraya dikhaunga.',
    'नक्की. {route}वन-वे कॅब बुक करूया. मी फक्त वन-वे भाडे दाखवेन.',
    'Nakki. {route}one-way cab book karuya. Mi fakt one-way bhade dakhven.',
  ],
  'ack.return': [
    "Sure. Let's book your return cab{route}. I'll show return fares and ask when you are coming back.",
    'बिल्कुल। {route}रिटर्न कैब बुक करते हैं। मैं रिटर्न किराया दिखाऊँगा और वापसी की तारीख़ और समय भी पूछूँगा।',
    'Bilkul. {route}return cab book karte hain. Main return kiraya dikhaunga aur wapsi ki date aur time bhi puchhunga.',
    'नक्की. {route}रिटर्न कॅब बुक करूया. मी रिटर्न भाडे दाखवेन आणि परतीची तारीख व वेळ पण विचारेन.',
    'Nakki. {route}return cab book karuya. Mi return bhade dakhven ani paratichi tarikh va vel pan vicharen.',
  ],
  'ack.outstation': [
    "Sure. Let's book your outstation cab{route}.",
    'बिल्कुल। {route}आउटस्टेशन कैब बुक करते हैं।',
    'Bilkul. {route}outstation cab book karte hain.',
    'नक्की. {route}आउटस्टेशन कॅब बुक करूया.',
    'Nakki. {route}outstation cab book karuya.',
  ],
  'ack.airportTo': [
    'Sure - a drop to the airport.', 'ज़रूर - एयरपोर्ट तक ड्रॉप।', 'Zaroor - airport tak drop.',
    'नक्की - विमानतळावर ड्रॉप.', 'Nakki - airport var drop.',
  ],
  'ack.airportFrom': [
    'Sure - a pickup from the airport.', 'ज़रूर - एयरपोर्ट से पिकअप।', 'Zaroor - airport se pickup.',
    'नक्की - विमानतळावरून पिकअप.', 'Nakki - airport varun pickup.',
  ],
  'ack.airport': [
    'Sure - an airport transfer.', 'ज़रूर - एयरपोर्ट ट्रांसफ़र।', 'Zaroor - airport transfer.',
    'नक्की - विमानतळ ट्रान्सफर.', 'Nakki - airport transfer.',
  ],
  'ack.generic': [
    'Happy to book that{fam}.', 'ज़रूर, बुक कर देते हैं।', 'Zaroor, book kar dete hain.', 'नक्की, बुक करूया.', 'Nakki, book karuya.',
  ],

  kind: [
    'What kind of trip is it?', 'यह किस तरह की यात्रा है?', 'Yeh kis tarah ki trip hai?',
    'कोणत्या प्रकारचा प्रवास आहे?', 'Kontya prakarcha pravas aahe?',
  ],
  route: [
    'Where are you going? These routes from Mumbai have a fixed fare:',
    'आप कहाँ जा रहे हैं? मुंबई से इन रूट्स का किराया तय है:',
    'Aap kahan ja rahe hain? Mumbai se in routes ka fixed kiraya hai:',
    'तुम्ही कुठे जात आहात? मुंबईहून या मार्गांचे भाडे ठरलेले आहे:',
    'Tumhi kuthe jaat aahat? Mumbai-hun ya routes che bhade tharlele aahe:',
  ],
  otherDestination: [
    'Which city or place are you going to? That route is quoted by the office, so there is no instant fare.',
    'आप किस शहर या जगह जा रहे हैं? उस रूट का किराया ऑफ़िस बताएगा, इसलिए तुरंत किराया नहीं दिखेगा।',
    'Aap kis shehar ya jagah ja rahe hain? Us route ka kiraya office batayega, isliye turant kiraya nahi dikhega.',
    'तुम्ही कोणत्या शहरात किंवा ठिकाणी जात आहात? त्या मार्गाचे भाडे ऑफिस सांगेल, त्यामुळे लगेच भाडे दिसणार नाही.',
    'Tumhi kontya shaharat kinva thikani jaat aahat? Tya route che bhade office sangel, tyamule lagech bhade disnar nahi.',
  ],
  leg: [
    '{route} - one way or return?', '{route} - वन-वे या रिटर्न?', '{route} - one-way ya return?',
    '{route} - वन-वे की रिटर्न?', '{route} - one-way ki return?',
  ],
  hourly: [
    'Which package? The car and chauffeur stay with you for it.',
    'कौन-सा पैकेज? गाड़ी और ड्राइवर उतने समय आपके साथ रहेंगे।',
    'Kaun sa package? Gaadi aur driver utne time aapke saath rahenge.',
    'कोणते पॅकेज? गाडी आणि चालक तेवढा वेळ तुमच्यासोबत राहतील.',
    'Konte package? Gaadi ani driver tevdha vel tumchyasobat rahtil.',
  ],
  airportWay: [
    'First, which direction is it - to the airport, or from the airport?',
    'पहले बताइए, दिशा क्या है - एयरपोर्ट जाना है या एयरपोर्ट से आना है?',
    'Pehle bataiye, direction kya hai - airport jaana hai ya airport se aana hai?',
    'आधी सांगा, दिशा कोणती - विमानतळावर जायचे आहे की विमानतळावरून यायचे आहे?',
    'Aadhi sanga, disha konti - airport var jaycha aahe ki airport varun yaycha aahe?',
  ],
  'airport.to': [
    'Which airport are you flying from?', 'आप किस एयरपोर्ट से उड़ान भर रहे हैं?', 'Aap kis airport se flight le rahe hain?',
    'तुम्ही कोणत्या विमानतळावरून उड्डाण करणार आहात?', 'Tumhi kontya airport varun flight ghenar aahat?',
  ],
  'airport.from': [
    'Which airport are you landing at?', 'आप किस एयरपोर्ट पर उतर रहे हैं?', 'Aap kis airport par land kar rahe hain?',
    'तुम्ही कोणत्या विमानतळावर उतरणार आहात?', 'Tumhi kontya airport var utarnar aahat?',
  ],
  pickup: [
    'What is the pickup address?', 'पिकअप का पता क्या है?', 'Pickup ka address kya hai?',
    'पिकअपचा पत्ता काय आहे?', 'Pickup cha patta kay aahe?',
  ],
  'pickup.airport': [
    'Where should we pick you up to take you to the airport?', 'एयरपोर्ट ले जाने के लिए आपको कहाँ से लें?',
    'Airport le jaane ke liye aapko kahan se lein?', 'विमानतळावर नेण्यासाठी तुम्हाला कुठून घ्यायचे?',
    'Airport var nenyasathi tumhala kuthun ghyayche?',
  ],
  'drop.city': [
    'Where in {city} - a hotel or address? Or tap below if the city is enough for now.',
    '{city} में कहाँ - होटल या पता? अभी शहर काफ़ी है तो नीचे टैप करें।',
    '{city} mein kahan - hotel ya address? Abhi shehar kaafi hai to neeche tap karein.',
    '{city} मध्ये कुठे - हॉटेल किंवा पत्ता? आत्ता शहर पुरेसे असेल तर खाली टॅप करा.',
    '{city} madhye kuthe - hotel kinva patta? Atta shahar puresa asel tar khali tap kara.',
  ],
  drop: ['And the drop address?', 'और ड्रॉप का पता?', 'Aur drop ka address?', 'आणि ड्रॉपचा पत्ता?', 'Ani drop cha patta?'],
  'drop.airport': [
    'Where should we drop you from the airport?', 'एयरपोर्ट से आपको कहाँ छोड़ें?', 'Airport se aapko kahan chhodein?',
    'विमानतळावरून तुम्हाला कुठे सोडायचे?', 'Airport varun tumhala kuthe sodaycha?',
  ],
  date: ['Which date?', 'किस तारीख़ को?', 'Kis date ko?', 'कोणत्या तारखेला?', 'Kontya tarkhela?'],
  'date.return': [
    'Which date do you leave?', 'जाने की तारीख़ क्या है?', 'Jaane ki date kya hai?', 'जाण्याची तारीख कोणती?', 'Janyachi tarikh konti?',
  ],
  time: ['What pickup time?', 'पिकअप का समय?', 'Pickup ka time?', 'पिकअपची वेळ?', 'Pickup chi vel?'],
  'time.landing': [
    'What time does the flight land?', 'फ़्लाइट कितने बजे उतरेगी?', 'Flight kitne baje land karegi?',
    'विमान किती वाजता उतरेल?', 'Flight kiti vajta land hoil?',
  ],
  returnDate: [
    'Which day are you coming back?', 'आप किस दिन वापस आ रहे हैं?', 'Aap kis din wapas aa rahe hain?',
    'तुम्ही कोणत्या दिवशी परत येणार?', 'Tumhi kontya divshi parat yenar?',
  ],
  returnTime: [
    'And what time should the return journey start?', 'और वापसी का सफ़र कितने बजे शुरू हो?',
    'Aur wapsi ka safar kitne baje shuru ho?', 'आणि परतीचा प्रवास किती वाजता सुरू व्हावा?',
    'Ani paraticha pravas kiti vajta suru vhava?',
  ],
  pax: ['How many passengers?', 'कितने यात्री हैं?', 'Kitne log travel kar rahe hain?', 'किती प्रवासी आहेत?', 'Kiti pravasi aahet?'],
  name: ['Your name, please?', 'आपका नाम?', 'Aapka naam?', 'तुमचे नाव?', 'Tumche naav?'],
  mobile: [
    'Your 10-digit mobile number? The chauffeur and the office use it.',
    'आपका 10 अंकों का मोबाइल नंबर? ड्राइवर और ऑफ़िस इसी पर संपर्क करेंगे।',
    'Aapka 10-digit mobile number? Driver aur office isi par contact karenge.',
    'तुमचा 10 अंकी मोबाइल नंबर? चालक आणि ऑफिस याच नंबरवर संपर्क करतील.',
    'Tumcha 10-digit mobile number? Driver ani office yach number var samparka kartil.',
  ],
  email: [
    'Your email ID? The booking details and invoice are sent there.',
    'आपकी ईमेल आईडी? बुकिंग की जानकारी और इनवॉइस वहीं भेजे जाएँगे।',
    'Aapki email ID? Booking details aur invoice wahi bheje jayenge.',
    'तुमचा ईमेल आयडी? बुकिंगची माहिती आणि इनव्हॉइस तिथे पाठवले जातील.',
    'Tumcha email ID? Booking chi mahiti ani invoice tithe pathavle jatil.',
  ],
  notes: [
    'Anything else we should know - luggage, a stop on the way, a child seat?',
    'कुछ और बताना है - सामान, रास्ते में रुकना, बच्चे की सीट?',
    'Kuch aur batana hai - saamaan, raste mein rukna, bachche ki seat?',
    'आणखी काही सांगायचे आहे का - सामान, वाटेत थांबा, लहान मुलाची सीट?',
    'Ankhi kahi sangayche aahe ka - saaman, vaatet thamba, lahan mulachi seat?',
  ],

  vehicles: [
    'Here are the {fam}options for this trip{fares}. Tap the one you want - the office confirms availability when it allots the car.',
    'इस यात्रा के लिए ये गाड़ियाँ हैं{fares}। जो चाहिए उस पर टैप करें - गाड़ी देते समय ऑफ़िस उपलब्धता पक्की करेगा।',
    'Is trip ke liye yeh gaadiyan hain{fares}. Jo chahiye us par tap karein - office gaadi dete waqt availability confirm karega.',
    'या प्रवासासाठी या गाड्या आहेत{fares}. हवी ती निवडा - गाडी देताना ऑफिस उपलब्धता निश्चित करेल.',
    'Ya pravasasathi ya gaadya aahet{fares}. Havi ti nivda - gaadi detana office availability confirm karel.',
  ],
  'fares.oneWay': [' (one-way fares)', ' (वन-वे किराया)', ' (one-way kiraya)', ' (वन-वे भाडे)', ' (one-way bhade)'],
  'fares.return': [' (return fares)', ' (रिटर्न किराया)', ' (return kiraya)', ' (रिटर्न भाडे)', ' (return bhade)'],
  noFamily: [
    'We do not run a {fam} on this kind of trip, so here is everything that does. ',
    'इस तरह की यात्रा पर {fam} नहीं चलती, इसलिए सभी उपलब्ध गाड़ियाँ दिखा रहे हैं। ',
    'Is tarah ki trip par {fam} nahi chalti, isliye saari available gaadiyan dikha rahe hain. ',
    'या प्रकारच्या प्रवासासाठी {fam} नाही, म्हणून सर्व उपलब्ध गाड्या दाखवत आहोत. ',
    'Ya prakarchya pravasasathi {fam} nahi, mhanun sarva available gaadya dakhvat aahot. ',
  ],
  check: [
    'Please check your booking:', 'कृपया अपनी बुकिंग जाँच लें:', 'Please apni booking check kar lijiye:',
    'कृपया तुमची बुकिंग तपासा:', 'Krupaya tumchi booking tapasa:',
  ],
  sure: [
    'Are you sure you want to book this cab? Nothing is booked until you tap Confirm booking.',
    'क्या आप यह कैब बुक करना चाहते हैं? जब तक आप "बुकिंग पक्की करें" नहीं दबाते, कुछ भी बुक नहीं होगा।',
    'Kya aap yeh cab book karna chahte hain? Jab tak aap "Booking confirm karein" nahi dabate, kuch book nahi hoga.',
    'ही कॅब बुक करायची आहे ना? "बुकिंग निश्चित करा" दाबेपर्यंत काहीही बुक होणार नाही.',
    'Hi cab book karaychi aahe na? "Booking confirm kara" dabepryant kahihi book honar nahi.',
  ],
  cancelled: [
    'No problem - nothing was booked. Ask me anything, or say "book a cab" to start again.',
    'कोई बात नहीं - कुछ बुक नहीं हुआ। कुछ भी पूछिए, या फिर से शुरू करने के लिए "कैब बुक करनी है" लिखिए।',
    'Koi baat nahi - kuch book nahi hua. Kuch bhi puchhiye, ya dobara shuru karne ke liye "cab book karni hai" likhiye.',
    'काही हरकत नाही - काहीही बुक झाले नाही. काहीही विचारा, किंवा पुन्हा सुरू करण्यासाठी "कॅब बुक करायची आहे" लिहा.',
    'Kahi harkat nahi - kahihi book jhala nahi. Kahihi vichara, kinva punha suru karnyasathi "cab book karaychi aahe" liha.',
  ],
  tapVehicle: [
    'Please tap one of the vehicles above, or Cancel booking.', 'कृपया ऊपर से कोई गाड़ी चुनें, या बुकिंग रद्द करें।',
    'Please upar se koi gaadi chuniye, ya booking cancel kijiye.', 'कृपया वरील एखादी गाडी निवडा, किंवा बुकिंग रद्द करा.',
    'Krupaya varil ekhadi gaadi nivda, kinva booking radd kara.',
  ],
  tapSummary: [
    'Tap Confirm booking, Modify details or Cancel above.',
    'ऊपर "बुकिंग पक्की करें", "जानकारी बदलें" या "रद्द करें" पर टैप करें।',
    'Upar "Booking confirm karein", "Details badlein" ya "Cancel" par tap karein.',
    'वर "बुकिंग निश्चित करा", "माहिती बदला" किंवा "रद्द करा" वर टॅप करा.',
    'Var "Booking confirm kara", "Mahiti badla" kinva "Radd kara" var tap kara.',
  ],
  modify: [
    'What would you like to change?', 'आप क्या बदलना चाहते हैं?', 'Aap kya badalna chahte hain?',
    'तुम्हाला काय बदलायचे आहे?', 'Tumhala kay badlaycha aahe?',
  ],
  confirmed: [
    'Booking confirmed! Your Trip ID is {id}.\n\nOur team will contact you shortly to confirm the car and chauffeur.\n\nTo get these details on WhatsApp, tap the green button: WhatsApp opens with everything already written - just press Send.',
    'बुकिंग हो गई! आपकी ट्रिप आईडी {id} है।\n\nहमारी टीम जल्द ही गाड़ी और ड्राइवर पक्का करने के लिए संपर्क करेगी।\n\nयह जानकारी WhatsApp पर पाने के लिए हरा बटन दबाएँ - सब कुछ पहले से लिखा होगा, बस Send दबाएँ।',
    'Booking ho gayi! Aapki Trip ID {id} hai.\n\nHamari team jaldi hi gaadi aur driver confirm karne ke liye contact karegi.\n\nYeh details WhatsApp par paane ke liye hara button dabaiye - sab pehle se likha hoga, bas Send dabaiye.',
    'बुकिंग झाली! तुमचा ट्रिप आयडी {id} आहे.\n\nआमची टीम लवकरच गाडी आणि चालक निश्चित करण्यासाठी संपर्क करेल.\n\nही माहिती WhatsApp वर मिळवण्यासाठी हिरवे बटण दाबा - सगळे आधीच लिहिलेले असेल, फक्त Send दाबा.',
    'Booking jhali! Tumcha Trip ID {id} aahe.\n\nAamchi team lavkarach gaadi ani driver confirm karnyasathi samparka karel.\n\nHi mahiti WhatsApp var milvnyasathi hirva button daba - sagla aadhich lihilela asel, fakt Send daba.',
  ],
  failed: [
    'That did not go through: {err} Your details are still here - tap Confirm booking again, or call us.',
    'बुकिंग नहीं हो पाई: {err} आपकी जानकारी सुरक्षित है - फिर से "बुकिंग पक्की करें" दबाएँ, या हमें कॉल करें।',
    'Booking nahi ho payi: {err} Aapki details safe hain - dobara "Booking confirm karein" dabaiye, ya humein call kijiye.',
    'बुकिंग झाली नाही: {err} तुमची माहिती जतन आहे - पुन्हा "बुकिंग निश्चित करा" दाबा, किंवा आम्हाला कॉल करा.',
    'Booking jhali nahi: {err} Tumchi mahiti jatan aahe - punha "Booking confirm kara" daba, kinva aamhala call kara.',
  ],

  'err.kind': [
    'Please pick one: Local, Airport transfer, Outstation or Hourly rental.',
    'कृपया एक चुनें: लोकल, एयरपोर्ट ट्रांसफ़र, आउटस्टेशन या घंटे के हिसाब से।',
    'Please ek chuniye: Local, Airport transfer, Outstation ya Hourly.',
    'कृपया एक निवडा: लोकल, विमानतळ ट्रान्सफर, आउटस्टेशन किंवा तासाप्रमाणे.',
    'Krupaya ek nivda: Local, Airport transfer, Outstation kinva Hourly.',
  ],
  'err.place': [
    'Please tell me the place you are going to.', 'कृपया बताइए आप कहाँ जा रहे हैं।', 'Please bataiye aap kahan ja rahe hain.',
    'कृपया तुम्ही कुठे जात आहात ते सांगा.', 'Krupaya tumhi kuthe jaat aahat te sanga.',
  ],
  'err.leg': ['One way or return?', 'वन-वे या रिटर्न?', 'One-way ya return?', 'वन-वे की रिटर्न?', 'One-way ki return?'],
  'err.hourly': [
    'Please pick 4, 8 or 12 hours.', 'कृपया 4, 8 या 12 घंटे चुनें।', 'Please 4, 8 ya 12 ghante chuniye.',
    'कृपया 4, 8 किंवा 12 तास निवडा.', 'Krupaya 4, 8 kinva 12 taas nivda.',
  ],
  'err.airportWay': [
    'To the airport, or from the airport?', 'एयरपोर्ट जाना है या एयरपोर्ट से आना है?', 'Airport jaana hai ya airport se aana hai?',
    'विमानतळावर जायचे की विमानतळावरून यायचे?', 'Airport var jaycha ki airport varun yaycha?',
  ],
  'err.airport': [
    'Please pick the airport from the list.', 'कृपया सूची से एयरपोर्ट चुनें।', 'Please list se airport chuniye.',
    'कृपया यादीतून विमानतळ निवडा.', 'Krupaya yaditun airport nivda.',
  ],
  'err.address': [
    'Please type the full address or area.', 'कृपया पूरा पता या इलाका लिखें।', 'Please poora address ya area likhiye.',
    'कृपया पूर्ण पत्ता किंवा भाग लिहा.', 'Krupaya purna patta kinva area liha.',
  ],
  'err.date': ['Please pick a date.', 'कृपया तारीख़ चुनें।', 'Please date chuniye.', 'कृपया तारीख निवडा.', 'Krupaya tarikh nivda.'],
  'err.datePast': [
    'That date has passed - please pick today or later.', 'वह तारीख़ निकल चुकी है - कृपया आज या बाद की तारीख़ चुनें।',
    'Woh date nikal chuki hai - please aaj ya baad ki date chuniye.', 'ती तारीख उलटून गेली आहे - कृपया आजची किंवा पुढची तारीख निवडा.',
    'Ti tarikh ulatun geli aahe - krupaya aajchi kinva pudhchi tarikh nivda.',
  ],
  'err.returnBefore': [
    'The return date is before the journey date.', 'वापसी की तारीख़ जाने की तारीख़ से पहले है।',
    'Wapsi ki date jaane ki date se pehle hai.', 'परतीची तारीख जाण्याच्या तारखेच्या आधी आहे.',
    'Paratichi tarikh janyachya tarkhechya aadhi aahe.',
  ],
  'err.time': [
    'Please pick a time, e.g. 10:00.', 'कृपया समय चुनें, जैसे 10:00.', 'Please time chuniye, jaise 10:00.',
    'कृपया वेळ निवडा, उदा. 10:00.', 'Krupaya vel nivda, uda. 10:00.',
  ],
  'err.pax': [
    'How many people are travelling? A number, please.', 'कितने लोग यात्रा कर रहे हैं? कृपया संख्या लिखें।',
    'Kitne log travel kar rahe hain? Please number likhiye.', 'किती लोक प्रवास करत आहेत? कृपया संख्या लिहा.',
    'Kiti lok pravas karat aahet? Krupaya sankhya liha.',
  ],
  'err.name': ['Please tell me your name.', 'कृपया अपना नाम बताइए।', 'Please apna naam bataiye.', 'कृपया तुमचे नाव सांगा.', 'Krupaya tumche naav sanga.'],
  'err.mobile': [
    'That does not look like a 10-digit mobile number.', 'यह 10 अंकों का मोबाइल नंबर नहीं लग रहा।',
    'Yeh 10-digit mobile number nahi lag raha.', 'हा 10 अंकी मोबाइल नंबर वाटत नाही.', 'Ha 10-digit mobile number vatat nahi.',
  ],
  'err.email': [
    'That email ID does not look right. Type it again, or tap "I don\'t have an email ID".',
    'यह ईमेल आईडी सही नहीं लग रही। दोबारा लिखें, या "मेरे पास ईमेल आईडी नहीं है" पर टैप करें।',
    'Yeh email ID sahi nahi lag rahi. Dobara likhiye, ya "Mere paas email ID nahi hai" par tap kijiye.',
    'हा ईमेल आयडी बरोबर वाटत नाही. पुन्हा लिहा, किंवा "माझ्याकडे ईमेल आयडी नाही" वर टॅप करा.',
    'Ha email ID barobar vatat nahi. Punha liha, kinva "Majhyakade email ID nahi" var tap kara.',
  ],

  'faq.note': ['', '(यह जानकारी अंग्रेज़ी में है।)\n\n', '(Yeh jaankari English mein hai.)\n\n', '(ही माहिती इंग्रजीत आहे.)\n\n', '(Hi mahiti English madhye aahe.)\n\n'],
  unsure: [
    'I am not certain which one you mean. Is it one of these?', 'मुझे पक्का नहीं पता आप किसकी बात कर रहे हैं। क्या इनमें से कोई है?',
    'Mujhe pakka nahi pata aap kiski baat kar rahe hain. Kya inmein se koi hai?', 'तुम्हाला नक्की काय म्हणायचे आहे ते कळले नाही. यापैकी एखादे आहे का?',
    'Tumhala nakki kay mhanaycha aahe te kalla nahi. Yapaiki ekhade aahe ka?',
  ],
  notFound: [
    '',
    'मेरे पास इसका पक्का जवाब नहीं है, इसलिए मैं अंदाज़ा नहीं लगाऊँगा। "Talk to a person" पर टैप करके अपना नंबर छोड़ें, हम कॉल करेंगे। मैं इनका जवाब दे सकता हूँ:',
    'Mere paas iska pakka jawab nahi hai, isliye main andaza nahi lagaunga. "Talk to a person" par tap karke apna number chhodiye, hum call karenge. Main inka jawab de sakta hoon:',
    'माझ्याकडे याचे निश्चित उत्तर नाही, म्हणून मी अंदाज लावणार नाही. "Talk to a person" वर टॅप करून तुमचा नंबर द्या, आम्ही कॉल करू. मी यांची उत्तरे देऊ शकतो:',
    'Majhyakade yache nishchit uttar nahi, mhanun mi andaj lavnar nahi. "Talk to a person" var tap karun tumcha number dya, aamhi call karu. Mi yanchi uttare deu shakto:',
  ],
  hello: [
    '',
    'नमस्ते! मैं कैब बुक कर सकता हूँ या आपके सवालों का जवाब दे सकता हूँ। बताइए, क्या मदद करूँ?',
    'Namaste! Main cab book kar sakta hoon ya aapke sawaalon ka jawab de sakta hoon. Bataiye, kya madad karoon?',
    'नमस्कार! मी कॅब बुक करू शकतो किंवा तुमच्या प्रश्नांची उत्तरे देऊ शकतो. सांगा, काय मदत करू?',
    'Namaskar! Mi cab book karu shakto kinva tumchya prashnanchi uttare deu shakto. Sanga, kay madat karu?',
  ],
  thanks: [
    '',
    'आपका स्वागत है! और कुछ मदद चाहिए तो बताइए।', 'Aapka swagat hai! Aur kuch madad chahiye to bataiye.',
    'तुमचे स्वागत आहे! आणखी काही मदत हवी असल्यास सांगा.', 'Tumche swagat aahe! Ankhi kahi madat havi aslyas sanga.',
  ],
} satisfies Record<string, Five>;

export type TextKey = keyof typeof TEXT;

/** What to say, in the customer's language, with {placeholders} filled in. */
export function t(lang: Lang, key: TextKey, vars: Record<string, string | number> = {}): string {
  const row: Five = TEXT[key];
  const s = row[COL[lang]] || row[0];
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/**
 * Button and row labels. The chip still carries its English value - that is
 * what the parser reads and what the office's chat record shows - and only
 * the words on it change.
 */
const LABEL: Record<string, [hi: string, hiLatn: string, mr: string, mrLatn: string]> = {
  'Local (within Mumbai)': ['लोकल (मुंबई में)', 'Local (Mumbai mein)', 'लोकल (मुंबईत)', 'Local (Mumbait)'],
  'Airport transfer': ['एयरपोर्ट ट्रांसफ़र', 'Airport transfer', 'विमानतळ ट्रान्सफर', 'Airport transfer'],
  Outstation: ['आउटस्टेशन', 'Outstation', 'आउटस्टेशन', 'Outstation'],
  'Hourly rental': ['घंटे के हिसाब से', 'Ghante ke hisaab se', 'तासाप्रमाणे', 'Taasapramane'],
  'One way': ['वन-वे', 'One-way', 'वन-वे', 'One-way'],
  Return: ['रिटर्न (आना-जाना)', 'Return (aana-jaana)', 'रिटर्न (जाऊन-येऊन)', 'Return (jaun-yeun)'],
  'Drop at airport': ['एयरपोर्ट जाना है', 'Airport jaana hai', 'विमानतळावर जायचे', 'Airport var jaycha'],
  'Pickup from airport': ['एयरपोर्ट से आना है', 'Airport se aana hai', 'विमानतळावरून यायचे', 'Airport varun yaycha'],
  Today: ['आज', 'Aaj', 'आज', 'Aaj'],
  Tomorrow: ['कल', 'Kal', 'उद्या', 'Udya'],
  "I don't have an email ID": ['मेरे पास ईमेल आईडी नहीं है', 'Mere paas email ID nahi hai', 'माझ्याकडे ईमेल आयडी नाही', 'Majhyakade email ID nahi'],
  'No, nothing else': ['नहीं, और कुछ नहीं', 'Nahi, aur kuch nahi', 'नाही, आणखी काही नाही', 'Nahi, ankhi kahi nahi'],
  Other: ['अन्य', 'Other', 'इतर', 'Itar'],
  'Cancel booking': ['बुकिंग रद्द करें', 'Booking cancel karein', 'बुकिंग रद्द करा', 'Booking radd kara'],
  'Confirm booking': ['बुकिंग पक्की करें', 'Booking confirm karein', 'बुकिंग निश्चित करा', 'Booking confirm kara'],
  'Modify details': ['जानकारी बदलें', 'Details badlein', 'माहिती बदला', 'Mahiti badla'],
  Cancel: ['रद्द करें', 'Cancel', 'रद्द करा', 'Radd kara'],
  Service: ['सेवा', 'Service', 'सेवा', 'Seva'],
  Vehicle: ['गाड़ी', 'Gaadi', 'गाडी', 'Gaadi'],
  Pickup: ['पिकअप', 'Pickup', 'पिकअप', 'Pickup'],
  Drop: ['ड्रॉप', 'Drop', 'ड्रॉप', 'Drop'],
  Date: ['तारीख़', 'Date', 'तारीख', 'Tarikh'],
  Time: ['समय', 'Time', 'वेळ', 'Vel'],
  'Pickup time': ['पिकअप समय', 'Pickup time', 'पिकअपची वेळ', 'Pickup vel'],
  'One way / return': ['वन-वे / रिटर्न', 'One-way / return', 'वन-वे / रिटर्न', 'One-way / return'],
  Direction: ['दिशा', 'Direction', 'दिशा', 'Disha'],
  'Return date': ['वापसी की तारीख़', 'Wapsi ki date', 'परतीची तारीख', 'Paratichi tarikh'],
  'Return time': ['वापसी का समय', 'Wapsi ka time', 'परतीची वेळ', 'Paratichi vel'],
  Passengers: ['यात्री', 'Log', 'प्रवासी', 'Pravasi'],
  Name: ['नाम', 'Naam', 'नाव', 'Naav'],
  Mobile: ['मोबाइल', 'Mobile', 'मोबाइल', 'Mobile'],
  Email: ['ईमेल', 'Email', 'ईमेल', 'Email'],
  Notes: ['नोट्स', 'Notes', 'टीप', 'Teep'],
  Fare: ['किराया', 'Kiraya', 'भाडे', 'Bhade'],
  'Estimated fare': ['अनुमानित किराया', 'Anumanit kiraya', 'अंदाजे भाडे', 'Andaje bhade'],
  'Trip plan': ['यात्रा योजना', 'Trip plan', 'प्रवास योजना', 'Trip plan'],
  'Not given': ['नहीं दी', 'Nahi di', 'दिलेला नाही', 'Dilela nahi'],
  'Quoted by the office': ['ऑफ़िस बताएगा', 'Office batayega', 'ऑफिस सांगेल', 'Office sangel'],
};

export function label(lang: Lang, value: string): string {
  if (lang === 'en') return value;
  const hit = LABEL[value];
  if (hit) return hit[COL[lang] - 1];
  // "Pune (address later)" - the city stays, the words around it change.
  const later = /^(.*) \(address later\)$/.exec(value);
  if (later) {
    const words = ['(पता बाद में)', '(address baad mein)', '(पत्ता नंतर)', '(patta nantar)'][COL[lang] - 1];
    return `${later[1]} ${words}`;
  }
  return value;
}

/** The note under the greeting, so a visitor knows they need not write English. */
export const LANGUAGE_HINT = 'You can also write in हिंदी or मराठी - आप हिंदी में लिख सकते हैं · तुम्ही मराठीत लिहू शकता.';
