const { Schema, model } = require('mongoose');

/** Secuencias (folios de pedido). */
const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = model('Counter', CounterSchema, 'counters');

/**
 * @param {string} name
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<number>}
 */
Counter.next = async (name, session) => {
  const c = await Counter.findOneAndUpdate(
    { _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true, session },
  );
  return c.seq;
};

module.exports = Counter;
