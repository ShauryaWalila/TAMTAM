// Rule-based finance categoriser. NO AI / NO network calls — pure pattern
// matching against a known merchant table. Privacy-preserving: nothing in
// your transaction descriptions ever leaves the device.
//
// To add a category: drop a new entry into `RULES`. The first matching
// pattern wins (top-down). Patterns are case-insensitive substring or
// regex matches on the raw description string (whatever the bank SMS or
// manual entry put there).
//
// India-first list (UPI handles, common merchants, banks). Easy to extend.

export type FinanceCategory =
  | 'Food & Dining'
  | 'Groceries'
  | 'Shopping'
  | 'Transport'
  | 'Fuel'
  | 'Bills & Utilities'
  | 'Mobile & Internet'
  | 'Entertainment'
  | 'Subscriptions'
  | 'Health & Pharmacy'
  | 'Fitness'
  | 'Education'
  | 'Travel & Stay'
  | 'Rent'
  | 'Investments'
  | 'Insurance'
  | 'Salary'
  | 'Cashback / Refund'
  | 'ATM Withdrawal'
  | 'Bank Transfer'
  | 'Gifts'
  | 'Donations'
  | 'Pets'
  | 'Beauty & Personal Care'
  | 'Home & Furniture'
  | 'Tax / Govt'
  | 'Misc';

type Rule = { match: (RegExp | string)[]; category: FinanceCategory };

// Helper: case-insensitive RegExp
const r = (src: string) => new RegExp(src, 'i');

export const RULES: Rule[] = [
  // ───────── FOOD & DINING ─────────
  { category: 'Food & Dining', match: [
    'swiggy', 'zomato', 'eatfit', 'freshmenu', 'faasos', 'behrouz', 'eatsure',
    "domino", "domino's", 'mcdonald', 'kfc', 'burger king', 'subway', 'pizza hut',
    "dunkin", 'taco bell', 'starbucks', 'cafe coffee day', 'ccd', 'chai point',
    'chayos', 'theobroma', 'cake', 'bakery', 'haldiram', 'bikanervala',
    'saravana', 'barbeque nation', 'bbq nation', 'mainland china', 'mainland',
    'biryani', 'irani', 'punjabi', 'dhaba', 'restaurant', 'kebab', 'kafe',
    'cafe', 'eateries', 'eats', 'cookhouse', 'foodtruck', 'food truck',
    'oven story', 'olo', 'wow momo', 'wow! momo', 'eatfit',
  ] },

  // ───────── GROCERIES ─────────
  { category: 'Groceries', match: [
    'bigbasket', 'big basket', 'grofers', 'blinkit', 'zepto', 'jiomart',
    'dmart', 'd-mart', 'reliance fresh', "spencer's", 'spencers', 'more retail',
    "nature's basket", 'natures basket', 'milkbasket', 'milk basket',
    'country delight', 'fruits', 'vegetable', 'kirana', 'general store',
    'supermart', 'super market', 'supermarket',
  ] },

  // ───────── MOBILE & INTERNET ─────────
  { category: 'Mobile & Internet', match: [
    r('\\bjio\\b'), 'airtel', r('\\bvi\\b'), r('\\bvodafone'), r('\\bidea\\b'),
    'bsnl', 'mtnl', 'reliance jio', 'jiofiber', 'jio fiber',
    'act fibernet', 'hathway', 'tikona', 'tata sky broadband',
    'recharge', 'broadband', 'wifi bill', 'data plan',
  ] },

  // ───────── BILLS & UTILITIES ─────────
  { category: 'Bills & Utilities', match: [
    'dish tv', 'tata sky', 'tata play', 'sun direct', 'd2h',
    'bescom', 'msedcl', 'tata power', 'adani electricity', 'bses',
    'torrent power', 'cesc', 'wbsedcl', 'kseb', 'tneb',
    'electricity', 'water bill', 'mahanagar gas', 'indraprastha gas',
    'gujarat gas', 'gas bill', 'gail',
    'piped gas', 'igl', 'mgl',
  ] },

  // ───────── TRANSPORT ─────────
  { category: 'Transport', match: [
    r('\\buber\\b'), r('\\bola\\b'), 'olacabs', 'rapido', 'meru',
    'metro', 'dmrc', 'bmrcl', 'irctc', 'rail', 'railways',
    'tolls?', 'fastag', 'parking', 'auto rickshaw', 'autorick',
  ] },

  // ───────── FUEL ─────────
  { category: 'Fuel', match: [
    'indian oil', 'iocl', 'hpcl', 'hindustan petroleum',
    'bpcl', 'bharat petroleum', 'reliance petrol', 'nayara',
    r('\\bshell\\b'), 'fuel', 'petrol pump', 'petrolpump', 'diesel',
  ] },

  // ───────── TRAVEL & STAY ─────────
  { category: 'Travel & Stay', match: [
    'makemytrip', 'mmt', 'goibibo', 'easemytrip', 'yatra', 'cleartrip',
    'ixigo', 'paytm travel', 'travelguru',
    'indigo', 'air india', 'vistara', 'spicejet', 'akasa', 'go first',
    'oyo', 'oyorooms', 'oyoo', 'booking.com', 'booking com',
    'agoda', 'airbnb', 'trivago', 'treebo', 'fabhotels', 'hostelworld',
    'hotel', 'resort', 'guesthouse', 'guest house', 'redbus',
  ] },

  // ───────── SHOPPING ─────────
  { category: 'Shopping', match: [
    'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa',
    'lenskart', 'firstcry', 'tata cliq', 'tatacliq', 'snapdeal',
    'croma', 'reliance digital', 'reliancedigital', 'vijay sales',
    'ikea', r('\\bh&m\\b'), r('\\bzara\\b'), 'decathlon', 'westside',
    'shoppers stop', 'pantaloons', 'lifestyle', 'max fashion',
    'pepperfry', 'urban ladder', r('\\buclothing\\b'), 'puma',
    'nike', 'adidas', 'levi', 'reebok',
  ] },

  // ───────── BEAUTY & PERSONAL CARE ─────────
  { category: 'Beauty & Personal Care', match: [
    'nykaa beauty', 'sephora', 'lakme salon', 'naturals', 'naturals salon',
    'looks salon', 'jawed habib', 'enrich', 'vlcc', 'kaya skin',
    'mamaearth', 'wow skin', 'sugar cosmetics', 'maybelline', 'loreal', "l'oreal",
    'plum goodness', 'minimalist', 'biotique', 'forest essentials',
  ] },

  // ───────── HOME & FURNITURE ─────────
  { category: 'Home & Furniture', match: [
    'urban ladder', 'pepperfry', 'home centre', 'home center', "homecentre",
    'ikea', 'godrej interio', 'wakefit', 'sleepyhead', 'sleep company',
    'wooden street', 'fabindia',
  ] },

  // ───────── ENTERTAINMENT ─────────
  { category: 'Entertainment', match: [
    'netflix', 'prime video', 'amazon prime', 'hotstar', 'disney+ hotstar',
    'jiocinema', 'jio cinema', 'sonyliv', 'sony liv', 'zee5', 'voot',
    'mx player', 'altbalaji', 'eros now',
    'pvr', 'inox', 'cinepolis', 'mukta a2', 'bookmyshow', 'bms',
    'paytm movies', 'ticketnew',
  ] },

  // ───────── SUBSCRIPTIONS (music + tools + cloud) ─────────
  { category: 'Subscriptions', match: [
    'spotify', 'apple music', 'wynk', 'gaana', 'jiosaavn', 'youtube premium',
    'yt premium', 'youtube music',
    'adobe', 'microsoft 365', 'office 365', 'google one', 'google workspace',
    'icloud', 'apple.com/bill', 'apple bill', 'apple services',
    'notion', 'figma', 'dropbox', 'github', 'openai', 'chatgpt',
    'canva', 'evernote', 'lastpass', '1password',
  ] },

  // ───────── HEALTH & PHARMACY ─────────
  { category: 'Health & Pharmacy', match: [
    'apollo', 'practo', '1mg', 'tata 1mg', 'netmeds', 'pharmeasy',
    'medlife', 'medplus', 'wellness forever', 'pharm easy',
    'cipla', 'sun pharma', 'lupin', 'glenmark', 'pfizer', 'mankind',
    'fortis', 'manipal', 'aiims', 'medanta', 'narayana', 'max hospital',
    'kokilaben', 'lilavati', 'cmc vellore', 'pgi', 'tata memorial',
    'pharmacy', 'medical', 'chemist', 'clinic', 'hospital',
    'diagnostic', 'pathlabs', 'thyrocare', 'metropolis', 'srl',
  ] },

  // ───────── INSURANCE ─────────
  { category: 'Insurance', match: [
    r('\\blic\\b'), 'lic of india', 'hdfc life', 'icici pru', 'icici prudential',
    'bajaj allianz', 'sbi life', 'tata aia', 'max life', 'star health',
    'religare health', 'care health', 'maxbupa', 'max bupa',
    'reliance general', 'iffco tokio', 'kotak general',
    'insurance premium', 'policy premium',
  ] },

  // ───────── FITNESS ─────────
  { category: 'Fitness', match: [
    'cult fit', 'cultfit', 'cure fit', 'curefit',
    'healthifyme', "gold's gym", 'golds gym', 'goldsgym',
    'talwalkars', 'anytime fitness', 'snap fitness',
    'decathlon', 'yoga', 'crossfit', 'pilates',
  ] },

  // ───────── EDUCATION ─────────
  { category: 'Education', match: [
    'byjus', "byju's", 'unacademy', 'vedantu', 'physicswallah',
    'coursera', 'udemy', 'edx', 'skillshare', 'linkedin learning',
    'khan academy', 'duolingo', 'wsj', 'kindle',
    'tuition', 'school fee', 'college fee', 'university fee', 'admission',
    'exam fee',
  ] },

  // ───────── RENT ─────────
  { category: 'Rent', match: [
    r('\\brent\\b'), 'house rent', 'flat rent', 'apartment rent',
    'nobroker', 'no broker', 'magicbricks', '99acres', 'housing.com',
    'pg charges', r('\\bpg\\b'),
  ] },

  // ───────── INVESTMENTS ─────────
  { category: 'Investments', match: [
    'zerodha', 'groww', 'upstox', r('\\bcoin\\b'), 'kuvera', 'paytm money',
    'icicidirect', 'icici direct', 'hdfc sec', 'hdfc securities',
    'sharekhan', 'angel one', 'angelbroking',
    'mutual fund', r('\\bmf\\b'), 'mf sip', r('\\bsip\\b'), 'systematic investment',
    'nps', 'national pension', 'ppf', 'epf', 'fixed deposit', r('\\bfd\\b'),
    'rd ', 'recurring deposit',
    'wazirx', 'coindcx', 'binance', 'coinbase', 'bitcoin', 'crypto',
  ] },

  // ───────── DONATIONS ─────────
  { category: 'Donations', match: [
    'donation', 'donate', 'akshaya patra', 'cry', 'goonj', 'isha foundation',
    'art of living', 'temple', 'mosque', 'church', 'gurudwara', 'mandir',
  ] },

  // ───────── GIFTS ─────────
  { category: 'Gifts', match: [
    'archies', 'ferns n petals', "ferns n' petals", 'fnp', 'igp.com', r('\\bigp\\b'),
    'bigsmall', 'big small', 'gift card', 'voucher',
  ] },

  // ───────── PETS ─────────
  { category: 'Pets', match: [
    'heads up for tails', 'pet', 'paw', 'vet', 'pedigree', 'whiskas',
    'royal canin', 'drools',
  ] },

  // ───────── TAX / GOVT ─────────
  { category: 'Tax / Govt', match: [
    r('\\bincome tax\\b'), 'incometax', 'cbdt', r('\\bgst\\b'),
    'property tax', 'rto', 'driving licence', 'passport', 'passport seva',
    'msme', 'epfo', 'esic', 'aadhaar',
  ] },

  // ───────── SALARY (income) ─────────
  { category: 'Salary', match: [
    r('salary'), r('payroll'), r('stipend'),
  ] },

  // ───────── CASHBACK / REFUND (income side) ─────────
  { category: 'Cashback / Refund', match: [
    'cashback', 'refund', 'reversal', 'reversed', 'returned',
    'amazon pay cashback', 'cred coins', 'cred cash',
  ] },

  // ───────── ATM ─────────
  { category: 'ATM Withdrawal', match: [
    r('\\batm\\b'), 'atm w/d', 'cash withdrawal', r('\\bcwd\\b'),
  ] },

  // ───────── BANK TRANSFER (generic UPI/NEFT) — last so it's a fallback ─────────
  { category: 'Bank Transfer', match: [
    'upi', r('\\bneft\\b'), r('\\bimps\\b'), r('\\brtgs\\b'),
    r('@paytm'), r('@upi'), r('@oksbi'), r('@okhdfcbank'), r('@okaxis'),
    r('@okicici'), r('@okbank'), r('@ybl'), r('@ibl'), r('@apl'), r('@axl'),
    'phonepe', 'phone pe', 'paytm', 'gpay', 'google pay', 'bhim',
  ] },
];

/**
 * Categorise a raw transaction description.
 * @param desc — the description text (from bank SMS body or manual entry).
 * @param amount — optional signed amount; if positive we bias toward income
 *                 categories before falling through.
 * @returns one of FinanceCategory. Always returns something (default 'Misc').
 */
export function categoriseDescription(desc: string | null | undefined, amount?: number): FinanceCategory {
  const s = (desc || '').trim();
  if (!s) return 'Misc';

  // Bias income-side keywords first if amount is positive — avoids a
  // "salary credited via NEFT" getting filed under Bank Transfer.
  if (typeof amount === 'number' && amount > 0) {
    if (matchAny(s, ['salary', 'payroll', 'stipend'])) return 'Salary';
    if (matchAny(s, ['cashback', 'refund', 'reversal', 'reversed', 'returned'])) return 'Cashback / Refund';
  }

  for (const rule of RULES) {
    if (matchAny(s, rule.match)) return rule.category;
  }
  return 'Misc';
}

function matchAny(text: string, patterns: (RegExp | string)[]): boolean {
  const t = text.toLowerCase();
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (t.includes(p.toLowerCase())) return true;
    } else {
      if (p.test(text)) return true;
    }
  }
  return false;
}

/** All categories — for filter UI / picker. */
export const ALL_CATEGORIES: FinanceCategory[] = [
  'Food & Dining', 'Groceries', 'Shopping', 'Transport', 'Fuel',
  'Bills & Utilities', 'Mobile & Internet', 'Entertainment', 'Subscriptions',
  'Health & Pharmacy', 'Fitness', 'Education', 'Travel & Stay', 'Rent',
  'Investments', 'Insurance', 'Salary', 'Cashback / Refund',
  'ATM Withdrawal', 'Bank Transfer', 'Gifts', 'Donations', 'Pets',
  'Beauty & Personal Care', 'Home & Furniture', 'Tax / Govt', 'Misc',
];

/** Emoji + colour per category — for chips and list rows. */
export const CATEGORY_META: Record<FinanceCategory, { emoji: string; color: string }> = {
  'Food & Dining':           { emoji: '🍕', color: '#FF9500' },
  'Groceries':               { emoji: '🛒', color: '#34C759' },
  'Shopping':                { emoji: '🛍️', color: '#AF52DE' },
  'Transport':               { emoji: '🚖', color: '#FFCC00' },
  'Fuel':                    { emoji: '⛽', color: '#FF3B30' },
  'Bills & Utilities':       { emoji: '💡', color: '#5AC8FA' },
  'Mobile & Internet':       { emoji: '📶', color: '#5856D6' },
  'Entertainment':           { emoji: '🎬', color: '#FF2D55' },
  'Subscriptions':           { emoji: '📦', color: '#007AFF' },
  'Health & Pharmacy':       { emoji: '💊', color: '#34C759' },
  'Fitness':                 { emoji: '🏋️', color: '#FF9500' },
  'Education':               { emoji: '📚', color: '#5856D6' },
  'Travel & Stay':           { emoji: '✈️', color: '#5AC8FA' },
  'Rent':                    { emoji: '🏠', color: '#8E8E93' },
  'Investments':             { emoji: '📈', color: '#34C759' },
  'Insurance':               { emoji: '🛡️', color: '#5856D6' },
  'Salary':                  { emoji: '💰', color: '#34C759' },
  'Cashback / Refund':       { emoji: '↩️', color: '#34C759' },
  'ATM Withdrawal':          { emoji: '🏧', color: '#8E8E93' },
  'Bank Transfer':           { emoji: '🏦', color: '#8E8E93' },
  'Gifts':                   { emoji: '🎁', color: '#FF2D55' },
  'Donations':               { emoji: '🤲', color: '#FF9500' },
  'Pets':                    { emoji: '🐾', color: '#AF52DE' },
  'Beauty & Personal Care':  { emoji: '💄', color: '#FF2D55' },
  'Home & Furniture':        { emoji: '🛋️', color: '#8E8E93' },
  'Tax / Govt':              { emoji: '🏛️', color: '#8E8E93' },
  'Misc':                    { emoji: '🪙', color: '#8E8E93' },
};
