import React from 'react';

const AdminShield = ({ totalRevenue, feeBalance }) => {
  return (
    <div className="p-6 bg-black border border-amber-500/20 rounded-xl">
      <h2 className="text-xl serif text-amber-500 mb-4">TREASURY OVERVIEW</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-zinc-900 rounded-lg">
          <p className="text-xs text-zinc-500 uppercase">Bot Activations</p>
          <p className="text-2xl font-bold text-white">$ {totalRevenue}</p>
        </div>
        <div className="p-4 bg-zinc-900 rounded-lg">
          <p className="text-xs text-zinc-500 uppercase">10% System Fees</p>
          <p className="text-2xl font-bold text-green-500">$ {feeBalance}</p>
        </div>
      </div>
      <button className="w-full mt-6 py-3 bg-amber-500 text-black font-bold uppercase tracking-widest hover:bg-amber-400 transition">
        Withdraw to TLNN...C4E
      </button>
    </div>
  );
};

export default AdminShield;
