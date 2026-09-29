/**
 * The assistant's starting knowledge: every intent it understands, and the
 * example questions that show each one, in the languages customers write.
 *
 * Loaded with INSERT OR IGNORE on every start (services/chatbotKnowledge), so
 * a new intent or example added here reaches an existing database, and
 * nothing the office has edited or switched off is ever overwritten.
 *
 * These are meanings, not answers. The answer to FARE_INQUIRY is read from the
 * fare master at the moment it is asked; the examples only teach the
 * assistant what a fare question looks like.
 */

export type SeedLang = 'en' | 'hi' | 'hi-Latn' | 'mr' | 'mr-Latn';

export interface SeedIntent {
  code: string;
  name: string;
  category: string;
  description: string;
  service?: 'LOCAL' | 'AIRPORT' | 'OUTSTATION' | 'HOURLY';
  required?: string;
  optional?: string;
  dynamic?: boolean;
  examples: Partial<Record<SeedLang, string[]>>;
}

export const SEED_INTENTS: SeedIntent[] = [
  // ------------------------------------------------------------ conversation
  {
    code: 'GREETING', name: 'Greeting', category: 'Conversation', description: 'Hello, namaste, good morning.',
    examples: {
      en: ['Hi', 'Hello', 'Hey', 'Hii', 'Good morning', 'Good evening', 'Hello sir', 'Hello madam'],
      'hi-Latn': ['Namaste', 'Namaste ji'], hi: ['नमस्ते'], mr: ['नमस्कार'], 'mr-Latn': ['Namaskar'],
    },
  },
  {
    code: 'GOODBYE', name: 'Goodbye', category: 'Conversation', description: 'The customer is leaving.',
    examples: { en: ['Bye', 'Goodbye', 'See you'], 'hi-Latn': ['Chalo bye', 'Phir milte hain'] },
  },
  {
    code: 'THANKS', name: 'Thank you', category: 'Conversation', description: 'Thanks in any language.',
    examples: {
      en: ['Thank you', 'Thanks', 'Thank you so much', 'Thanks a lot'],
      'hi-Latn': ['Thank you bhai', 'Dhanyawad', 'Shukriya'], hi: ['धन्यवाद'], mr: ['धन्यवाद तुम्ही मदत केली'],
    },
  },
  {
    code: 'HELP', name: 'Help', category: 'Conversation', description: 'A general request for help.',
    examples: { en: ['I need help', 'Can someone help me?'], 'hi-Latn': ['Mujhe help chahiye'] },
  },
  {
    code: 'AFFIRM', name: 'Yes', category: 'Conversation', description: 'Yes / okay, answering the question just asked.',
    examples: { en: ['Yes', 'Yeah', 'Yup', 'Okay', 'Sure', 'Yes please'], 'hi-Latn': ['Haan', 'Ha', 'Ji'], mr: ['हो', 'होय', 'करा'] },
  },
  {
    code: 'DENY', name: 'No', category: 'Conversation', description: 'No / not now.',
    examples: { en: ['No', 'Nope', 'Not now'], 'hi-Latn': ['Nahi', 'Nahin'], 'mr-Latn': ['Nako'], mr: ['नाही', 'नको'] },
  },

  // --------------------------------------------------------------- services
  {
    code: 'SERVICE_INFORMATION', name: 'Services offered', category: 'Services',
    description: 'What can be booked on the portal.',
    examples: {
      en: ['What services do you provide?', 'What type of cab bookings are available?', 'What can I book from your website?', 'What do you provide?', 'What is this website?'],
      'hi-Latn': ['Aapki kaunsi services available hain?', 'Aap kaunsi cab service dete ho?', 'Mujhe cab book karni hai, kya options hain?'],
      mr: ['तुमच्या कोणत्या कॅब सेवा उपलब्ध आहेत?'],
    },
  },
  {
    code: 'LOCAL_BOOKING', name: 'Local cab', category: 'Booking', service: 'LOCAL', optional: 'pickup,drop,date,time,pax',
    description: 'A cab within Mumbai, Thane or Navi Mumbai.',
    examples: {
      en: ['Local cab available?', 'Mumbai local cab?', 'I need a cab within Mumbai.', 'Mumbai city cab price?', 'Local taxi booking?', 'Cab for local travel?', 'Do you provide local cabs?'],
      'hi-Latn': ['Mujhe Mumbai mein local cab chahiye.', 'Mumbai ke andar cab kitne ki hai?', 'Mumbai local taxi milegi?', 'Mumbai mein city ride available hai?', 'Andheri se Bandra cab chahiye'],
      mr: ['मुंबईमध्ये लोकल कॅब मिळेल का?', 'मुंबई शहरात कॅब बुक करायची आहे.', 'मुंबईमध्ये लोकल कॅब पाहिजे.', 'लोकल कॅब मिळते का?'],
      hi: ['मुंबई में लोकल कैब चाहिए।'],
    },
  },
  {
    code: 'AIRPORT_BOOKING', name: 'Airport transfer', category: 'Booking', service: 'AIRPORT', required: 'direction,airport', optional: 'pickup,drop,date,time,pax',
    description: 'To or from the airport - the direction is asked first.',
    examples: {
      en: ['Do you provide airport cabs?', 'Airport taxi available?', 'I need an airport cab.', 'Airport transfer available?', 'Mumbai airport cab?', 'Mumbai airport taxi?'],
      'hi-Latn': ['Airport cab milti hai?'], mr: ['एअरपोर्ट कॅब उपलब्ध आहे का?'],
    },
  },
  {
    code: 'AIRPORT_TO', name: 'Drop at the airport', category: 'Booking', service: 'AIRPORT',
    description: 'Going to the airport to catch a flight.',
    examples: {
      en: ['I want to go to the airport.', 'I need airport drop.', 'Airport drop?'],
      'hi-Latn': ['Airport jaana hai.', 'Ghar se airport jaana hai.', 'Mujhe airport drop chahiye.'],
      hi: ['मुझे एयरपोर्ट जाना है।'], mr: ['मला एअरपोर्टला जायचे आहे.', 'एअरपोर्ट ड्रॉप पाहिजे.'],
    },
  },
  {
    code: 'AIRPORT_FROM', name: 'Pickup from the airport', category: 'Booking', service: 'AIRPORT',
    description: 'Coming off a flight.',
    examples: {
      en: ['I need a cab from the airport.', 'Can you pick me up from the airport?', 'Airport pickup?'],
      'hi-Latn': ['Airport se ghar jaana hai.', 'Airport pickup chahiye.', 'Airport se Andheri jaana hai.'],
      mr: ['एअरपोर्टवरून घरी जायचे आहे.', 'एअरपोर्ट पिकअप पाहिजे.'],
    },
  },
  {
    code: 'OUTSTATION_BOOKING', name: 'Outstation cab', category: 'Booking', service: 'OUTSTATION', required: 'route,leg', optional: 'date,time,pax',
    description: 'A trip out of Mumbai.',
    examples: {
      en: ['Do you provide outstation cabs?', 'I need an outstation taxi.', 'Mumbai to Pune cab.', 'Mumbai to Lonavala taxi.', 'Mumbai to Nashik cab.', 'I want to travel outside Mumbai.', 'Mumbai outstation cab?', 'Cab from Mumbai to Nashik?'],
      'hi-Latn': ['Outstation booking kaise kare?', 'Mumbai se Pune cab chahiye.', 'Mumbai se Lonavala jana hai.', 'Outstation ke liye car chahiye.'],
      mr: ['मला आउटस्टेशन कॅब पाहिजे.', 'मुंबईहून पुण्याला जायचे आहे.', 'आउटस्टेशन कॅब मिळते का?', 'मला पुण्याला जाण्यासाठी कॅब बुक करायची आहे.'],
      hi: ['मुझे पुणे के लिए कैब बुक करनी है।'],
    },
  },
  {
    code: 'HOURLY_BOOKING', name: 'Hourly package', category: 'Booking', service: 'HOURLY', optional: 'hours,pickup,date,time',
    description: 'A car and chauffeur for 4, 8 or 12 hours.',
    examples: {
      en: ['I need a cab for 4 hours.', 'Cab for 8 hours?', 'Full day cab?', 'Hourly taxi available?', 'I need a car for 6 hours.', '8 hour package available?', 'Do you have hourly packages?'],
      'hi-Latn': ['Mujhe 8 ghante ke liye cab chahiye.', '4 hours ke liye car chahiye.', 'Pura din cab chahiye.', 'Ghante ke hisab se cab milegi?', 'Hourly cab milti hai?', '8 ghante ke liye car chahiye.'],
      mr: ['मला ८ तासांसाठी कॅब पाहिजे.', 'तासावर कॅब मिळते का?'],
    },
  },
  {
    code: 'ONE_WAY_BOOKING', name: 'One way', category: 'Booking', service: 'OUTSTATION',
    description: 'Going only - never shown return fares.',
    examples: {
      en: ['I want a one-way cab.', 'One-way taxi available?', 'One-way Mumbai Pune cab.', 'I only need a cab for going.', 'Can I book a one-way cab?'],
      'hi-Latn': ['Return nahi chahiye.', 'Sirf Pune jaana hai.', 'Mujhe one-way cab chahiye.', 'Ek taraf ki cab chahiye.', 'One side cab chahiye.'],
      mr: ['फक्त पुण्याला जायचे आहे.', 'मला वन-वे कॅब पाहिजे.'],
    },
  },
  {
    code: 'RETURN_BOOKING', name: 'Return trip', category: 'Booking', service: 'OUTSTATION',
    description: 'There and back - asks the return date and time.',
    examples: {
      en: ['I need a return cab.', 'Mumbai to Pune and back.', 'I want to come back in the same cab.', 'Round trip available?', 'Can I book a return cab?'],
      'hi-Latn': ['Return booking chahiye.', 'Aana jaana dono hai.', 'Mumbai se Pune jaake wapas Mumbai aana hai.', 'Pune ke liye return cab chahiye.', 'Mujhe round trip book karni hai.', 'Pune se Mumbai jaake wapas bhi aana hai.'],
      mr: ['परतीची कॅब पाहिजे.', 'येऊन परत जायचे आहे.', 'मला पुण्याला जाऊन परत मुंबईला यायचे आहे.'],
      hi: ['मुझे पुणे जाकर वापस मुंबई आना है।'],
    },
  },
  {
    code: 'CUSTOM_ROUTE', name: 'Other destination', category: 'Booking', service: 'OUTSTATION',
    description: 'A place with no fixed fare - quoted by the office, never priced instantly.',
    examples: {
      en: ['I want to go somewhere else.', "My destination isn't listed.", 'Other destination.', 'Can I enter my own destination?', 'Custom route available?'],
      'hi-Latn': ['Other location hai.', 'Mera destination list mein nahi hai.', 'Dusri jagah jaana hai.', 'Mujhe custom route chahiye.', 'Mujhe Mumbai se Nashik nahi, kisi aur jagah jaana hai.'],
    },
  },
  {
    code: 'BOOKING_CREATE', name: 'Book a cab', category: 'Booking',
    description: 'Wants to book, trip type not said yet.',
    examples: {
      en: ['I want to book a cab.', 'How can I book a cab?', 'Can I book a taxi online?', 'I need a cab.', 'I want to make a booking.', 'How do I make a booking?', 'Can you help me book a car?', 'Book a cab for me.', 'I want to reserve a car.', 'Can I book a cab for tomorrow?'],
      'hi-Latn': ['Mujhe cab book karni hai.', 'Cab kaise book karu?', 'Taxi booking kaise kare?', 'Mujhe gaadi chahiye.', 'Mere liye cab book karo.', 'Online cab book ho sakti hai?', 'Kal ke liye cab chahiye.'],
      mr: ['मला कॅब बुक करायची आहे.', 'कॅब कशी बुक करू?', 'मला गाडी हवी आहे.', 'कॅब ऑनलाइन बुक करता येते का?', 'उद्यासाठी कॅब हवी आहे.'],
    },
  },

  // ------------------------------------------------------------------- fares
  {
    code: 'FARE_INQUIRY', name: 'Fare', category: 'Fare', required: 'route', optional: 'leg,vehicle', dynamic: true,
    description: 'The price of a trip - read from the fare master, never guessed.',
    examples: {
      en: ['What is the fare from Mumbai to Pune?', 'Mumbai to Pune price?', 'How much does Mumbai to Pune cost?', 'Mumbai Pune cab rate?', 'Share the fare.', 'Tell me the cost.', 'Please share fare for Mumbai to Nashik'],
      'hi-Latn': ['Pune ka fare?', 'Mumbai se Pune kitne paise lagenge?', 'Mumbai se Pune ka kitna padega?', 'Mumbai se Pune ka bhada kitna hai?', 'Mumbai se Pune ki cab kitne ki hai?', 'Mujhe Mumbai se Pune ke paise bataiye.', 'Mumbai se Pune ka rate kya hai?', 'Mumbai se Pune ka fare batao.', 'Mumbai se Pune cab kitne mein padegi?', 'Bhai Pune ka rate?'],
      hi: ['मुंबई से पुणे का किराया कितना है?', 'मुंबई से पुणे कितने पैसे लगेंगे?', 'मुंबई से पुणे जाने का किराया कितना है?'],
      mr: ['मुंबई ते पुणे कॅब कितीला येईल?', 'पुण्याचे भाडे किती आहे?'],
      'mr-Latn': ['Mumbai to Pune cha fare kiti aahe?'],
    },
  },
  {
    code: 'FARE_BREAKDOWN', name: 'What the fare includes', category: 'Fare', dynamic: true,
    description: 'Inclusions, fare breakup.',
    examples: { en: ['What does the fare include?', 'Why is the fare this much?', 'Fare breakup?'], 'hi-Latn': ['Fare mein kya kya included hai?'] },
  },
  {
    code: 'TOLL_INFORMATION', name: 'Toll', category: 'Fare', optional: 'route', dynamic: true,
    description: 'Whether toll is in the fare - from the fare master.',
    examples: {
      en: ['Is toll included?', 'Is toll charge included in fare?'],
      'hi-Latn': ['Toll extra hai?', 'Toll included hai?', 'Toll alag se dena padega?', 'Toll ka kya hai?', 'Toll included hai kya?'],
    },
  },
  {
    code: 'EXTRA_CHARGES', name: 'Extra charges', category: 'Fare',
    description: 'Hidden or extra charges.',
    examples: { en: ['Any extra charges?', 'Are there hidden charges?', 'Extra charges?'], 'hi-Latn': ['Koi extra charge hai?', 'Hidden charges hain kya?'] },
  },

  // ---------------------------------------------------------------- vehicles
  {
    code: 'VEHICLE_INFORMATION', name: 'Vehicles', category: 'Vehicle', dynamic: true,
    description: 'The fleet, from the catalogue.',
    examples: {
      en: ['Which cars are available?', 'What vehicles do you have?', 'Which car will I get?', 'Available cab types?', 'Ertiga available?', 'Dzire available?', 'Honda City available?', 'Innova Crysta available?', 'Kia Carens available?'],
      'hi-Latn': ['Kaunsi gaadi available hai?', 'Kaunsi car milegi?'], hi: ['कौनसी गाड़ी उपलब्ध है?'],
    },
  },
  {
    code: 'STANDARD_VEHICLE', name: 'Standard cab', category: 'Vehicle', dynamic: true,
    description: 'Sedan - Dzire, Aura.',
    examples: { en: ['Standard cab', 'Normal cab', 'Sedan available?'] },
  },
  {
    code: 'SUV_MUV', name: 'SUV / MUV', category: 'Vehicle', dynamic: true,
    description: 'Ertiga, XL6 - not premium.',
    examples: { en: ['SUV available?', 'MUV available?', 'XL6 available?'], 'hi-Latn': ['SUV hai kya?'] },
  },
  {
    code: 'PREMIUM_VEHICLE', name: 'Premium', category: 'Vehicle', dynamic: true,
    description: 'Honda City, Ciaz, Innova Crysta, Kia Carens.',
    examples: { en: ['Premium car available?', 'What is your premium car?', 'Premium sedan'], 'hi-Latn': ['Premium car chahiye.'] },
  },
  {
    code: 'VEHICLE_CAPACITY', name: 'How many fit', category: 'Vehicle', optional: 'pax', dynamic: true,
    description: 'Seats and luggage.',
    examples: {
      en: ['How many people can travel?', 'How many passengers are allowed?', 'Can 4 people travel?', 'Can 6 people travel?'],
      'hi-Latn': ['Kitne log ja sakte hain?'], hi: ['कितने लोग जा सकते हैं?'],
    },
  },
  {
    code: 'PASSENGER_INFORMATION', name: 'Passengers', category: 'Vehicle', optional: 'pax', dynamic: true,
    description: 'The customer says how many are travelling.',
    examples: { en: ['We are 5 passengers.', 'We are travelling with family.'], 'hi-Latn': ['4 log hain.', '6 passenger hain.'] },
  },

  // -------------------------------------------------------- trip details
  {
    code: 'PICKUP_INFORMATION', name: 'Pickup', category: 'Trip details',
    description: 'Where the car starts.',
    examples: { en: ['Where will you pick me up?', 'Can I select pickup?', 'Pickup location?', 'Pickup from Andheri?'], 'hi-Latn': ['Pickup kaha se hoga?', 'Pickup location kaise select kare?'], hi: ['मुझे कहाँ से पिकअप करेंगे?'] },
  },
  {
    code: 'DROP_INFORMATION', name: 'Drop', category: 'Trip details',
    description: 'Where the trip ends.',
    examples: { en: ['Where will I be dropped?', 'Can I select drop?', 'Drop location?'], 'hi-Latn': ['Drop kaha hoga?', 'Drop location change kar sakte hain?'] },
  },
  {
    code: 'MULTI_STOP', name: 'Extra pickups or drops', category: 'Trip details',
    description: 'Another pickup, another drop, several stops.',
    examples: {
      en: ['Can I add another pickup?', 'Can I add another drop?', 'I have two pickup locations.', 'Multiple stops available?'],
      'hi-Latn': ['Ek aur pickup add karna hai.', 'Ek aur drop add karna hai.', 'Do jagah se passenger pickup karna hai.', 'Multiple location possible hai?'],
    },
  },
  {
    code: 'DATE_SELECTION', name: 'Travel date', category: 'Trip details', optional: 'date',
    description: 'When the trip is.',
    examples: { en: ['Can I book for tomorrow?', 'Cab for today?', 'Cab for Sunday?', 'I need it on 28 September.', 'Tomorrow morning cab.'], 'hi-Latn': ['Kal cab chahiye.', 'Parso cab chahiye.', '28 tarikh ko cab chahiye.'], mr: ['उद्या कॅब पाहिजे.'] },
  },
  {
    code: 'TIME_SELECTION', name: 'Pickup time', category: 'Trip details', optional: 'time',
    description: 'What time the car comes.',
    examples: { en: ['What time can I book?', 'Cab at 10 AM?', 'I need a cab at 6 PM.', 'Morning cab?', 'Night cab?'], 'hi-Latn': ['Subah 8 baje cab chahiye.', 'Raat ko 10 baje cab chahiye.'] },
  },

  // --------------------------------------------------- an existing booking
  {
    code: 'BOOKING_MODIFY', name: 'Change a booking', category: 'My booking',
    description: 'Change pickup, drop, date, time or passengers.',
    examples: {
      en: ['I want to change my booking.', 'Change pickup.', 'Change drop.', 'Change date.', 'Change time.', 'Change passengers.', 'Can I modify my booking?'],
      'hi-Latn': ['Booking change karni hai.', 'Pickup change karna hai.', 'Date change karni hai.', 'Time change karna hai.', 'Booking modify kar sakte hain?'],
    },
  },
  {
    code: 'BOOKING_CANCEL', name: 'Cancel a booking', category: 'My booking',
    description: 'Cancellation and its charges - from the policy.',
    examples: {
      en: ['I want to cancel my booking.', 'Can I cancel?', 'How do I cancel?', 'Cancellation charges?', 'Is cancellation free?'],
      'hi-Latn': ['Booking cancel karni hai.', 'Cancellation ka charge hai?', 'Cab cancel kar sakte hain?'], mr: ['मला बुकिंग रद्द करायची आहे.'],
    },
  },
  {
    code: 'BOOKING_STATUS', name: 'Booking status', category: 'My booking', required: 'tripId,mobile', dynamic: true,
    description: 'Looked up by Trip ID and the last four digits of the mobile.',
    examples: {
      en: ['Where is my booking?', 'Is my booking confirmed?', 'Booking status?', 'Has my booking been confirmed?'],
      'hi-Latn': ['Meri booking confirm hui?', 'Booking ka status kya hai?'], hi: ['मेरी बुकिंग कन्फर्म हुई है?'],
    },
  },
  {
    code: 'BOOKING_CONFIRMATION', name: 'Booking confirmation', category: 'My booking', dynamic: true,
    description: 'The confirmation after booking in the chat.',
    examples: { en: ['Did my booking go through?', 'Send me the booking confirmation.'] },
  },
  {
    code: 'DRIVER_INFORMATION', name: 'My driver', category: 'My booking', required: 'tripId,mobile', dynamic: true,
    description: 'Only what the trip page itself shares, after the same check.',
    examples: {
      en: ['Who is my driver?', 'Driver name?', 'Driver contact?', 'Has driver been assigned?', 'Driver assigned?'],
      'hi-Latn': ['Driver kaha hai?', 'Driver ka naam kya hai?', 'Driver ka number milega?', 'Driver assigned hua?', 'Driver assign hua kya?'],
      mr: ['ड्रायव्हर कोण आहे?', 'ड्रायव्हरची माहिती मिळेल का?'], hi: ['ड्राइवर की जानकारी चाहिए।'],
    },
  },
  {
    code: 'VEHICLE_ASSIGNMENT', name: 'My vehicle', category: 'My booking', required: 'tripId,mobile', dynamic: true,
    description: 'The car allotted to a booking.',
    examples: {
      en: ['Which vehicle is assigned?', 'What is the car number?', 'Which car will arrive?', 'Vehicle number?', 'Cab model?'],
      'hi-Latn': ['Kaunsi car aayegi?', 'Gadi number kya hai?'], mr: ['गाडी कोणती आहे?'],
    },
  },

  // ------------------------------------------------------- money & papers
  {
    code: 'PAYMENT_INFORMATION', name: 'Payment', category: 'Payment',
    description: 'Only what the portal says about payment.',
    examples: {
      en: ['How can I pay?', 'Online payment available?', 'Cash payment?', 'UPI available?', 'Card payment?'],
      'hi-Latn': ['Payment kab karna hai?', 'Cash de sakte hain?', 'UPI se payment ho sakta hai?', 'Online payment kaise kare?'],
    },
  },
  {
    code: 'INVOICE_INFORMATION', name: 'Invoice / receipt', category: 'Payment',
    description: 'GST invoices, where to download.',
    examples: {
      en: ['Can I get an invoice?', 'Where is my receipt?', 'Send invoice.', 'Need billing details.'],
      'hi-Latn': ['Invoice chahiye.', 'Receipt kaha milegi?', 'Bill milega?', 'Invoice WhatsApp/email par bhej sakte hain?'],
    },
  },

  // --------------------------------------------------------------- contact
  {
    code: 'WHATSAPP_REQUEST', name: 'Send on WhatsApp', category: 'Support',
    description: 'Opens WhatsApp with the text written - no WhatsApp API.',
    examples: {
      en: ['Can you send this on WhatsApp?', 'WhatsApp number?'],
      'hi-Latn': ['WhatsApp par bhej do.', 'Details WhatsApp pe bhejo.', 'Fare WhatsApp pe bhej sakte ho?', 'Booking details WhatsApp pe bhejna.', 'Quote WhatsApp pe bhejo.', 'WhatsApp pe contact kar sakte hain?'],
    },
  },
  {
    code: 'CONTACT_SUPPORT', name: 'Contact / support', category: 'Support',
    description: 'Phone, WhatsApp, email and office address - from the company settings.',
    examples: {
      en: ['Customer support?', 'How can I contact you?', 'Contact number?', 'Support email?', 'Help me with my booking.', 'What is your phone number?', 'Email address?', 'Office address?', 'Where are you located?', 'Who are you?'],
      'hi-Latn': ['Customer care number kya hai?', 'Support se baat karni hai.', 'Aapka number kya hai?', 'Email ID kya hai?'],
    },
  },
  {
    code: 'CORPORATE_BOOKING', name: 'Corporate', category: 'Corporate',
    description: 'Company accounts - routed to the corporate enquiry.',
    examples: {
      en: ['Do you provide corporate cab services?', 'Corporate account available?', 'I need cars regularly for my company.', 'Monthly cab requirement?', 'Employee transportation?', 'Corporate rate?', 'Mumbai corporate car rental?'],
      'hi-Latn': ['Company ke liye regular cab chahiye.', 'Corporate booking kaise kare?'],
    },
  },
  {
    code: 'BULK_BOOKING', name: 'Several vehicles', category: 'Corporate',
    description: 'Many cars at once.',
    examples: { en: ['Bulk cab booking?', 'I need 5 cars for a wedding.'], 'hi-Latn': ['Bulk mein cars chahiye.'] },
  },
  {
    code: 'INQUIRY_CREATE', name: 'Send an enquiry', category: 'Support',
    description: 'Leave details for a callback.',
    examples: { en: ['I want to send an enquiry.', 'Please call me back.'], 'hi-Latn': ['Mujhe call back chahiye.'] },
  },
  {
    code: 'INQUIRY_STATUS', name: 'Enquiry status', category: 'My booking', dynamic: true,
    description: 'An enquiry is a trip with a Trip ID, looked up the same way.',
    examples: { en: ['What happened to my enquiry?', 'Enquiry status?'] },
  },

  // --------------------------------------------------------------- feedback
  {
    code: 'FEEDBACK', name: 'Feedback', category: 'Feedback',
    description: 'The feedback form comes by email after the trip is completed.',
    examples: {
      en: ['I want to give feedback.', 'Where can I give feedback?', 'How do I give feedback?', 'I received a feedback email.', 'I want to add comments.'],
      'hi-Latn': ['Service ka feedback dena hai.'],
    },
  },
  {
    code: 'DRIVER_RATING', name: 'Rate the driver', category: 'Feedback',
    description: 'Part of the feedback form.',
    examples: { en: ['I want to rate the driver.', 'I want to rate my driver.'], 'hi-Latn': ['Driver ko rating deni hai.'], mr: ['ड्रायव्हरला रेटिंग द्यायचे आहे.', 'मला ड्रायव्हरला रेटिंग द्यायचे आहे.'], hi: ['मुझे ड्राइवर को रेटिंग देनी है।'] },
  },
  {
    code: 'SERVICE_RATING', name: 'Rate the service', category: 'Feedback',
    description: 'Part of the feedback form.', examples: { en: ['I want to rate the service.'] },
  },
  {
    code: 'CAB_RATING', name: 'Rate the cab', category: 'Feedback',
    description: 'Part of the feedback form.', examples: { en: ['I want to rate the cab.'] },
  },
  {
    code: 'COMPLAINT', name: 'Complaint', category: 'Feedback',
    description: 'Taken down and sent to the office as an enquiry.',
    examples: {
      en: ['I have a complaint.', 'Driver behaved badly.', 'Cab was late.', 'Cab was dirty.', 'Service issue.', 'I want to report a problem.', 'I want to complain.'],
      'hi-Latn': ['Complaint kaha kare?', 'Driver ki complaint hai.', 'Cab late thi.', 'Cab clean nahi thi.', 'Complaint karni hai.'],
    },
  },
  {
    code: 'SUGGESTION', name: 'Suggestion', category: 'Feedback',
    description: 'Taken down and sent to the office.', examples: { en: ['I have a suggestion.'], 'hi-Latn': ['Suggestion dena hai.'] },
  },
  {
    code: 'TRIP_COMPLETED', name: 'Trip completed', category: 'Feedback',
    description: 'After the office marks a trip completed the feedback email goes out automatically.',
    examples: { en: ['My trip is completed.', 'Trip is over, what next?'] },
  },

  // ------------------------------------------------------------ fall-backs
  {
    code: 'OUT_OF_SCOPE', name: 'Not about our travel', category: 'Other',
    description: 'Declined by name, never guessed at.',
    examples: { en: ["Who won yesterday's cricket match?", 'What is the weather today?'] },
  },
  {
    code: 'UNKNOWN_INTENT', name: 'Not understood', category: 'Other',
    description: 'Logged for the office to map to an intent.', examples: {},
  },
];

/** Place names and the ways people spell them. */
export const SEED_ENTITIES: { type: string; value: string; display: string; synonyms: string }[] = [
  { type: 'LOCATION', value: 'mumbai', display: 'Mumbai', synonyms: 'bombay, mumabi, mumbi, mumbay, मुंबई' },
  { type: 'LOCATION', value: 'pune', display: 'Pune', synonyms: 'poona, puna, punee, पुणे, पुणा' },
  { type: 'LOCATION', value: 'lonavala', display: 'Lonavala', synonyms: 'lonavla, lonawala, lonawla, लोणावळा, लोनावला' },
  { type: 'LOCATION', value: 'nashik', display: 'Nashik', synonyms: 'nasik, naashik, नाशिक' },
  { type: 'LOCATION', value: 'alibaug', display: 'Alibaug', synonyms: 'alibag, alibagh, अलिबाग' },
  { type: 'LOCATION', value: 'shirdi', display: 'Shirdi', synonyms: 'sirdi, shirdhi, शिर्डी' },
  { type: 'LOCATION', value: 'mahabaleshwar', display: 'Mahabaleshwar', synonyms: 'mahabaleswar, mahableshwar, महाबळेश्वर' },
  { type: 'LOCATION', value: 'satara', display: 'Satara', synonyms: 'सातारा' },
  { type: 'LOCATION', value: 'kolhapur', display: 'Kolhapur', synonyms: 'kolapur, कोल्हापूर' },
  { type: 'LOCATION', value: 'surat', display: 'Surat', synonyms: 'soorat, सूरत' },
  { type: 'LOCATION', value: 'ahmedabad', display: 'Ahmedabad', synonyms: 'ahemadabad, amdavad, ahmadabad, अहमदाबाद' },
  { type: 'LOCATION', value: 'vapi', display: 'Vapi', synonyms: 'वापी' },
  { type: 'VEHICLE', value: 'sedan', display: 'Standard (sedan)', synonyms: 'standard, normal cab, dzire, aura, small car' },
  { type: 'VEHICLE', value: 'suv', display: 'SUV / MUV', synonyms: 'muv, ertiga, xl6, 6 seater, 7 seater' },
  { type: 'VEHICLE', value: 'premium', display: 'Premium', synonyms: 'honda city, ciaz, innova, crysta, carens, luxury' },
  { type: 'SERVICE', value: 'hourly', display: 'Hourly package', synonyms: 'full day, half day, ghante ke hisab se, tasavar' },
  { type: 'TRIP_TYPE', value: 'one way', display: 'One way', synonyms: 'one side, single side, ek taraf, sirf jaana' },
  { type: 'TRIP_TYPE', value: 'return', display: 'Return', synonyms: 'round trip, both side, aana jaana, jaun yeun' },
  { type: 'FARE_TERM', value: 'fare', display: 'Fare', synonyms: 'price, cost, rate, charges, amount, tariff, fee, kiraya, bhada, paise' },
];
