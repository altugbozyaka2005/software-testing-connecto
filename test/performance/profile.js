// Synthetic operational profile for load tests: what people type into "What are you doing right now?".
// There is no production usage data in this testing copy, so the mix is an assumption (documented as
// a limitation in docs/evaluation.md): mostly common activities, a long tail of rarer ones, some
// typos and non-English text. Deterministic: activityFor(i) always returns the same text.
const COMMON = [
  'studying for exams', 'coding a side project', 'at the gym', 'reading a novel', 'playing valorant',
  'learning spanish', 'cooking dinner', 'watching netflix', 'working on my thesis', 'practicing guitar',
];
const TAIL = [
  'knitting a scarf', 'training for a marathon', 'learning to draw anime', 'doing leetcode', 'cleaning my room',
  'meditating', 'writing a short story', 'planning a trip to japan', 'baking sourdough', 'playing chess online',
  'building a react app', 'revising organic chemistry', 'gardening', 'composing music', 'doing yoga',
];
const MESSY = ['progamming in pythn', 'stdying calculus', 'satranç oynuyorum', 'ders çalışıyorum', 'jugando al ajedrez', 'chillin rn'];

function activityFor(i) {
  const r = (i * 2654435761) % 100; // deterministic spread
  if (r < 60) return COMMON[i % COMMON.length];
  if (r < 90) return TAIL[i % TAIL.length];
  return MESSY[i % MESSY.length];
}

module.exports = { activityFor, COMMON, TAIL, MESSY };
