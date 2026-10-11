/* MacroScan global config + namespace.
   NOTE: the USDA FoodData Central API key is embedded for this personal app.
   Get your own free key at https://fdc.nal.usda.gov/api-key-signup.html */
window.MS = window.MS || {};

MS.VERSION = '3.3.3';

MS.config = {
  USDA_KEY: '2EHlU49tO7PX93DeXfdTXwaK4YYEAVRytTJumgIQ',
  USDA_BASE: 'https://api.nal.usda.gov/fdc/v1',
  OFF_BASE: 'https://world.openfoodfacts.org/api/v2',
  USER_AGENT: 'MacroScan/1.0 (KaiOS; gabebrpierce@gmail.com)'
};

MS.MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

/* kcal per gram of macro — for deriving calories when missing */
MS.ATWATER = { protein: 4, carb: 4, fat: 9 };
