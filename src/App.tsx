/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Download, 
  Calculator, 
  Users, 
  ShoppingBag, 
  History, 
  LogOut, 
  LogIn,
  ChevronRight,
  ChevronDown,
  Save,
  X,
  Share2,
  Check,
  AlertCircle,
  Sparkles,
  Home,
  Calendar,
  User as UserIcon,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  deleteDoc, 
  doc, 
  updateDoc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { db, auth, signIn, logOut } from './firebase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Member {
  id: string;
  name: string;
  roomRentEnabled: boolean;
  messBillEnabled: boolean;
  totalDays: number;
  uid: string;
}

interface Purchase {
  id: string;
  description: string;
  amount: number;
  date: string;
  memberId: string;
  uid: string;
}

interface Summary {
  id: string;
  month: string;
  totalRoomRent: number;
  totalPurchase: number;
  totalDays: number;
  perDayRate: number;
  memberDetails: string; // JSON string
  uid: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

// Error Handler
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Components
const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      setHasError(true);
      setErrorMsg(e.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-4">
        <div className="bg-slate-900 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center border border-slate-800">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
          <p className="text-slate-400 mb-6">{errorMsg || 'An unexpected error occurred.'}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-500 text-white py-3 rounded-xl font-semibold hover:bg-red-600 transition-colors"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [totalRoomRent, setTotalRoomRent] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'members' | 'purchases' | 'history' | 'calculator'>('members');
  
  // Calculator State
  const [calcInput, setCalcInput] = useState('');
  const [calcHistory, setCalcHistory] = useState<string[]>([]);
  const [calcResult, setCalcResult] = useState<number | null>(null);

  const isAdmin = useMemo(() => {
    return user?.email === "sakeerputhan@gmail.com";
  }, [user]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Data Listeners
  useEffect(() => {
    if (!user) return;

    const qMembers = query(collection(db, 'members'), where('uid', '==', user.uid));
    const unsubMembers = onSnapshot(qMembers, (snapshot) => {
      setMembers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'members'));

    const qPurchases = query(collection(db, 'purchases'), where('uid', '==', user.uid));
    const unsubPurchases = onSnapshot(qPurchases, (snapshot) => {
      setPurchases(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Purchase)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'purchases'));

    const qSummaries = query(collection(db, 'summaries'), where('uid', '==', user.uid));
    const unsubSummaries = onSnapshot(qSummaries, (snapshot) => {
      setSummaries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Summary)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'summaries'));

    return () => {
      unsubMembers();
      unsubPurchases();
      unsubSummaries();
    };
  }, [user]);

  // Calculations
  const calculations = useMemo(() => {
    const totalPurchase = purchases.reduce((sum, p) => sum + p.amount, 0);
    const messEnabledMembers = members.filter(m => m.messBillEnabled);
    const totalMessDays = messEnabledMembers.reduce((sum, m) => sum + m.totalDays, 0);
    const perDayRate = totalMessDays > 0 ? totalPurchase / totalMessDays : 0;
    
    const rentPayingMembers = members.filter(m => m.roomRentEnabled).length;
    const roomRentPerMember = rentPayingMembers > 0 ? totalRoomRent / rentPayingMembers : 0;

    const memberDetails = members.map(m => {
      const memberPurchases = purchases.filter(p => p.memberId === m.id).reduce((sum, p) => sum + p.amount, 0);
      const messBill = m.messBillEnabled ? m.totalDays * perDayRate : 0;
      const roomRent = m.roomRentEnabled ? roomRentPerMember : 0;
      const totalBill = messBill + roomRent;
      const balance = totalBill - memberPurchases;
      
      return {
        ...m,
        memberPurchases,
        messBill,
        roomRent,
        totalBill,
        balance
      };
    });

    return {
      totalPurchase,
      totalDays: totalMessDays,
      perDayRate,
      roomRentPerMember,
      memberDetails
    };
  }, [members, purchases, totalRoomRent]);

  // Actions
  const addMember = async (name: string, roomRentEnabled: boolean, messBillEnabled: boolean, totalDays: number) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'members'), {
        name,
        roomRentEnabled,
        messBillEnabled,
        totalDays,
        uid: user.uid
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'members');
    }
  };

  const deleteMember = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'members', id));
      // Also delete related purchases
      const relatedPurchases = purchases.filter(p => p.memberId === id);
      for (const p of relatedPurchases) {
        await deleteDoc(doc(db, 'purchases', p.id));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'members');
    }
  };

  const updateMemberDays = async (id: string, newDays: number) => {
    try {
      await updateDoc(doc(db, 'members', id), { totalDays: newDays });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'members');
    }
  };

  const addPurchase = async (description: string, amount: number, memberId: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'purchases'), {
        description,
        amount,
        date: new Date().toISOString(),
        memberId,
        uid: user.uid
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'purchases');
    }
  };

  const deletePurchase = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'purchases', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'purchases');
    }
  };

  const saveSummary = async () => {
    if (!user) return;
    const month = format(new Date(), 'MMMM yyyy');
    try {
      await addDoc(collection(db, 'summaries'), {
        month,
        totalRoomRent,
        totalPurchase: calculations.totalPurchase,
        totalDays: calculations.totalDays,
        perDayRate: calculations.perDayRate,
        memberDetails: JSON.stringify(calculations.memberDetails),
        uid: user.uid
      });
      alert('Summary saved successfully!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'summaries');
    }
  };

  // Calculator Logic
  const handleCalc = (val: string) => {
    if (val === '=') {
      try {
        // Simple eval-like logic for basic math
        const result = Function(`"use strict"; return (${calcInput})`)();
        setCalcResult(result);
        setCalcHistory(prev => [...prev, `${calcInput} = ${result}`]);
        setCalcInput(result.toString());
      } catch {
        alert('Invalid calculation');
      }
    } else if (val === 'C') {
      setCalcInput('');
      setCalcResult(null);
    } else {
      setCalcInput(prev => prev + val);
    }
  };

  // PDF Export
  const exportPDF = () => {
    const doc = new jsPDF();
    const month = format(new Date(), 'MMMM yyyy');
    
    // Header
    doc.setFontSize(22);
    doc.setTextColor(41, 128, 185);
    doc.text('ROOMEX - Expense Report', 105, 20, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setTextColor(100);
    doc.text(`Period: ${month}`, 105, 30, { align: 'center' });

    // Summary Section
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('General Summary', 14, 45);
    autoTable(doc, {
      startY: 50,
      head: [['Metric', 'Value']],
      body: [
        ['Total Room Rent', `₹${totalRoomRent.toFixed(2)}`],
        ['Total Purchase', `₹${calculations.totalPurchase.toFixed(2)}`],
        ['Total Mess Days', `${calculations.totalDays} days`],
        ['Per Day Rate', `₹${calculations.perDayRate.toFixed(2)}`],
      ],
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185] }
    });

    // Member Details Section
    doc.text('Member Breakdown', 14, (doc as any).lastAutoTable.finalY + 15);
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Name', 'Days', 'Purchase', 'Mess Bill', 'Rent', 'Total', 'Payable']],
      body: calculations.memberDetails.map(m => [
        m.name,
        m.totalDays,
        `₹${m.memberPurchases.toFixed(2)}`,
        `₹${m.messBill.toFixed(2)}`,
        `₹${m.roomRent.toFixed(2)}`,
        `₹${m.totalBill.toFixed(2)}`,
        { 
          content: `₹${m.balance.toFixed(2)}`, 
          styles: { textColor: m.balance < 0 ? [0, 150, 0] : [0, 0, 255] } 
        }
      ]),
      theme: 'grid',
      headStyles: { fillColor: [39, 174, 96] }
    });

    doc.save(`ROOMEX_Report_${month.replace(' ', '_')}.pdf`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Calculator className="w-12 h-12 text-indigo-500" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-slate-900 p-10 rounded-4xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-slate-800 max-w-md w-full text-center relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1.5 bg-indigo-600" />
          <div className="w-24 h-24 bg-indigo-950/30 rounded-3xl flex items-center justify-center mx-auto mb-8 relative">
            <Calculator className="w-12 h-12 text-indigo-500" />
            <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-slate-800 rounded-xl shadow-lg flex items-center justify-center border border-slate-700">
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
          </div>
          <h1 className="text-5xl font-display font-black text-white mb-3 tracking-tight">ROOMEX</h1>
          <p className="text-slate-400 mb-10 text-lg font-medium">Smart Room & Mess Expense Manager</p>
          <button 
            onClick={signIn}
            className="w-full flex items-center justify-center gap-3 bg-indigo-600 text-white py-4.5 rounded-2xl font-bold hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-xl shadow-indigo-900/40 group"
          >
            <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            Sign in with Google
          </button>
          <p className="mt-8 text-xs text-slate-500 font-medium uppercase tracking-widest">Secure & Private</p>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-black text-slate-100 font-sans pb-24">
        {/* Header */}
        <header className="bg-black/80 backdrop-blur-xl border-b border-slate-800 sticky top-0 z-30 px-6 py-5">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/40">
                <Calculator className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-display font-black tracking-tight leading-none text-white">ROOMEX</h1>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Dashboard</span>
              </div>
            </div>
            <div className="flex items-center gap-5">
              <div className="hidden md:block text-right">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Active User</p>
                <p className="text-sm font-bold text-white">{user.displayName}</p>
              </div>
              <button 
                onClick={logOut}
                className="w-10 h-10 flex items-center justify-center bg-slate-900 hover:bg-red-950/30 hover:text-red-500 rounded-xl text-slate-400 transition-all border border-slate-800"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto p-6 space-y-8">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard label="Total Purchase" value={`₹${calculations.totalPurchase.toLocaleString()}`} color="bg-emerald-600" icon={<ShoppingBag className="w-5 h-5 text-white" />} />
            <StatCard label="Per Day Rate" value={`₹${calculations.perDayRate.toFixed(2)}`} color="bg-indigo-600" icon={<Calculator className="w-5 h-5 text-white" />} />
            <StatCard label="Total Days" value={`${calculations.totalDays}`} color="bg-amber-600" icon={<Users className="w-5 h-5 text-white" />} />
            <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl shadow-black/20 flex flex-col justify-between group hover:border-indigo-500/50 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Room Rent</span>
                <div className="p-2 rounded-xl bg-slate-800 text-slate-500 group-hover:bg-indigo-950/30 group-hover:text-indigo-400 transition-colors">
                  <Home className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-bold text-xl">₹</span>
                <input 
                  type="number" 
                  value={totalRoomRent} 
                  onChange={(e) => setTotalRoomRent(Number(e.target.value))}
                  className="w-full font-display font-black text-3xl focus:outline-none bg-transparent placeholder-slate-700 text-white"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800 max-w-2xl mx-auto backdrop-blur-sm">
            <TabButton active={activeTab === 'members'} onClick={() => setActiveTab('members')} icon={<Users className="w-4 h-4" />} label="Members" />
            <TabButton active={activeTab === 'purchases'} onClick={() => setActiveTab('purchases')} icon={<ShoppingBag className="w-4 h-4" />} label="Purchases" />
            <TabButton active={activeTab === 'calculator'} onClick={() => setActiveTab('calculator')} icon={<Calculator className="w-4 h-4" />} label="Calculator" />
            <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History className="w-4 h-4" />} label="History" />
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            {activeTab === 'members' && (
              <motion.div 
                key="members"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {isAdmin && <AddMemberForm onAdd={addMember} />}
                <div className="grid gap-4">
                  {calculations.memberDetails.map((m) => (
                    <MemberCard 
                      key={m.id} 
                      member={m} 
                      onDelete={deleteMember} 
                      onUpdateDays={updateMemberDays} 
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'purchases' && (
              <motion.div 
                key="purchases"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <AddPurchaseForm members={members} onAdd={addPurchase} />
                <div className="bg-slate-900 rounded-4xl border border-slate-800 shadow-xl shadow-black/20 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-800/50 border-b border-slate-800">
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Item Details</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Buyer</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] text-right">Amount</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {purchases.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-800/30 transition-colors group">
                            <td className="px-8 py-5">
                              <p className="font-bold text-white">{p.description}</p>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">{format(new Date(p.date), 'MMM dd, HH:mm')}</p>
                            </td>
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 bg-indigo-950/30 rounded-lg flex items-center justify-center text-[10px] font-black text-indigo-400 uppercase">
                                  {(members.find(m => m.id === p.memberId)?.name || '?')[0]}
                                </div>
                                <span className="text-sm font-bold text-slate-300">
                                  {members.find(m => m.id === p.memberId)?.name || 'Unknown'}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-right font-display font-black text-indigo-400 text-lg">₹{p.amount}</td>
                            <td className="px-8 py-5 text-right">
                              {isAdmin && (
                                <button 
                                  onClick={() => deletePurchase(p.id)} 
                                  className="w-9 h-9 flex items-center justify-center text-slate-600 hover:text-red-500 hover:bg-red-950/30 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {purchases.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-8 py-20 text-center">
                              <div className="flex flex-col items-center gap-3 opacity-20">
                                <ShoppingBag className="w-12 h-12" />
                                <p className="font-bold uppercase tracking-widest text-xs">No purchases recorded</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'calculator' && (
              <motion.div 
                key="calculator"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid lg:grid-cols-5 gap-8"
              >
                <div className="lg:col-span-3 bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />
                  <div className="bg-slate-800/50 backdrop-blur-md p-6 rounded-3xl mb-8 text-right min-h-[140px] flex flex-col justify-end border border-slate-700/50">
                    <p className="text-slate-500 font-mono text-lg mb-2 tracking-wider">{calcInput || '0'}</p>
                    <p className="text-white text-5xl font-display font-black tracking-tight">{calcResult !== null ? calcResult : '0'}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', 'C', '+', '='].map(btn => (
                      <button
                        key={btn}
                        onClick={() => handleCalc(btn)}
                        className={cn(
                          "h-16 rounded-2xl font-display font-bold text-xl transition-all active:scale-90",
                          btn === '=' ? "col-span-2 bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : 
                          ['/', '*', '-', '+'].includes(btn) ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" :
                          btn === 'C' ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        )}
                      >
                        {btn}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lg:col-span-2 bg-slate-900 p-8 rounded-4xl border border-slate-800 shadow-xl shadow-black/20 flex flex-col">
                  <h3 className="font-bold text-slate-500 uppercase text-[10px] tracking-[0.2em] mb-6">Calculation History</h3>
                  <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {calcHistory.map((h, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-800 group">
                        <span className="text-slate-400 font-medium font-mono">{h.split('=')[0]}</span>
                        <span className="text-indigo-400 font-display font-black">= {h.split('=')[1]}</span>
                      </div>
                    ))}
                    {calcHistory.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full py-12 opacity-20">
                        <History className="w-10 h-10 mb-3 text-slate-400" />
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">No history</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex justify-between items-center px-2">
                  <h2 className="text-xl font-display font-black text-white tracking-tight">Saved Summaries</h2>
                  {isAdmin && (
                    <button 
                      onClick={saveSummary}
                      className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
                    >
                      <Save className="w-4 h-4" />
                      Save Current
                    </button>
                  )}
                </div>
                <div className="grid gap-6">
                  {summaries.map((s) => (
                    <div key={s.id} className="bg-slate-900 p-8 rounded-4xl border border-slate-800 shadow-xl shadow-black/20 flex flex-col sm:flex-row sm:items-center justify-between gap-6 group hover:border-indigo-500/30 transition-all">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-slate-800 rounded-3xl flex items-center justify-center text-slate-500 border border-slate-700 group-hover:bg-indigo-950/30 group-hover:text-indigo-400 transition-colors">
                          <Calendar className="w-8 h-8" />
                        </div>
                        <div>
                          <h3 className="font-display font-bold text-2xl text-white mb-1">{s.month}</h3>
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total:</span>
                              <span className="text-sm font-bold text-slate-300">₹{s.totalPurchase.toFixed(2)}</span>
                            </div>
                            <div className="w-1 h-1 bg-slate-700 rounded-full" />
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rate:</span>
                              <span className="text-sm font-bold text-slate-300">₹{s.perDayRate.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button 
                          onClick={() => {
                            const details = JSON.parse(s.memberDetails);
                            console.table(details);
                            alert('Check console for detailed table view (feature coming soon to UI)');
                          }}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-slate-800 text-slate-300 rounded-2xl font-bold hover:bg-slate-700 transition-all border border-slate-700"
                        >
                          <ChevronRight className="w-5 h-5" />
                          Details
                        </button>
                        <button 
                          onClick={async () => {
                            if (isAdmin && confirm('Delete this summary?')) {
                              await deleteDoc(doc(db, 'summaries', s.id));
                            }
                          }}
                          className={cn(
                            "w-12 h-12 flex items-center justify-center bg-red-950/30 text-red-500 rounded-2xl hover:bg-red-900/50 transition-all border border-red-900/20",
                            !isAdmin && "opacity-0 pointer-events-none"
                          )}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {summaries.length === 0 && (
                    <div className="bg-slate-900/50 py-24 rounded-4xl border border-dashed border-slate-800 flex flex-col items-center gap-4 opacity-30">
                      <History className="w-16 h-16 text-slate-500" />
                      <p className="font-display font-bold text-lg uppercase tracking-[0.3em] text-slate-500">No history found</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Floating Action Buttons */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-40 bg-slate-900/80 backdrop-blur-md p-2 rounded-2xl border border-slate-800 shadow-2xl">
          <button 
            onClick={exportPDF}
            className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
          >
            <Download className="w-5 h-5" />
            Export PDF
          </button>
          <button 
            onClick={() => {
              const text = `ROOMEX Report - ${format(new Date(), 'MMM yyyy')}\nTotal Purchase: ₹${calculations.totalPurchase}\nPer Day Rate: ₹${calculations.perDayRate.toFixed(2)}\n\nCheck your payable amount in the app!`;
              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
            }}
            className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
          >
            <Share2 className="w-5 h-5" />
            Share WhatsApp
          </button>
        </div>
      </div>
    </ErrorBoundary>
  );
}

// Sub-components
function StatCard({ label, value, color, icon }: { label: string, value: string, color: string, icon: React.ReactNode }) {
  return (
    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl shadow-black/20 flex flex-col justify-between group hover:shadow-2xl hover:border-slate-700 transition-all">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{label}</span>
        <div className={cn("p-2 rounded-xl shadow-lg", color)}>{icon}</div>
      </div>
      <span className="text-3xl font-display font-black tracking-tight text-white">{value}</span>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl font-bold text-sm transition-all duration-300",
        active ? "bg-slate-800 text-indigo-400 shadow-lg shadow-black/20" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

const AddMemberForm: React.FC<{ onAdd: (name: string, rent: boolean, mess: boolean, days: number) => void | Promise<void> }> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [rent, setRent] = useState(true);
  const [mess, setMess] = useState(true);
  const [days, setDays] = useState(30);

  return (
    <div className="bg-slate-900 p-8 rounded-4xl border border-slate-800 shadow-xl shadow-black/20">
      <h3 className="font-display font-bold text-white mb-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-950/30 rounded-xl flex items-center justify-center">
          <Plus className="w-4 h-4 text-indigo-500" />
        </div>
        Add New Member
      </h3>
      <div className="grid sm:grid-cols-4 gap-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Full Name</label>
          <input 
            type="text" 
            placeholder="e.g. Rahul Sharma" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all text-white placeholder-slate-600"
          />
        </div>
        <div className="flex flex-col gap-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Settings</label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center justify-between bg-slate-800 border border-slate-700 rounded-2xl px-4 py-2.5">
              <span className="text-xs font-bold text-slate-400">Rent</span>
              <button 
                onClick={() => setRent(!rent)}
                className={cn(
                  "w-9 h-5 rounded-full transition-colors relative",
                  rent ? "bg-indigo-600" : "bg-slate-700"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                  rent ? "right-0.5" : "left-0.5"
                )} />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-between bg-slate-800 border border-slate-700 rounded-2xl px-4 py-2.5">
              <span className="text-xs font-bold text-slate-400">Mess</span>
              <button 
                onClick={() => setMess(!mess)}
                className={cn(
                  "w-9 h-5 rounded-full transition-colors relative",
                  mess ? "bg-emerald-600" : "bg-slate-700"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                  mess ? "right-0.5" : "left-0.5"
                )} />
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Days in Mess</label>
          <input 
            type="number" 
            placeholder="30" 
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all text-white placeholder-slate-600"
          />
        </div>
        <div className="flex items-end">
          <button 
            onClick={() => {
              if (name) {
                onAdd(name, rent, mess, days);
                setName('');
              }
            }}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20"
          >
            <Plus className="w-5 h-5" />
            Add Member
          </button>
        </div>
      </div>
    </div>
  );
}

const MemberCard: React.FC<{ 
  member: any, 
  onDelete: (id: string) => void | Promise<void>,
  onUpdateDays: (id: string, days: number) => void | Promise<void>,
  isAdmin: boolean
}> = ({ member, onDelete, onUpdateDays, isAdmin }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDays, setEditedDays] = useState(member.totalDays);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    await onUpdateDays(member.id, editedDays);
    setIsEditing(false);
  };

  return (
    <div className="bg-slate-900 p-6 rounded-4xl border border-slate-800 shadow-xl shadow-black/20 flex flex-col sm:flex-row sm:items-center justify-between gap-6 group hover:border-indigo-500/30 transition-all">
      <div className="flex items-center gap-5">
        <div className="w-16 h-16 bg-slate-800 rounded-3xl flex items-center justify-center text-slate-500 font-display font-black text-2xl uppercase border border-slate-700 group-hover:bg-indigo-950/30 group-hover:text-indigo-400 transition-colors">
          {member.name[0]}
        </div>
        <div>
          <h4 className="font-display font-bold text-xl text-white mb-1.5">{member.name}</h4>
          <div className="flex flex-wrap items-center gap-2">
            {isEditing && isAdmin ? (
              <div className="flex items-center gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700">
                <input 
                  type="number" 
                  value={editedDays}
                  onChange={(e) => setEditedDays(Number(e.target.value))}
                  className="w-12 bg-transparent text-[10px] font-bold text-white focus:outline-none px-1"
                  autoFocus
                />
                <button onClick={handleSave} className="text-emerald-400 hover:text-emerald-500">
                  <Check className="w-3 h-3" />
                </button>
                <button onClick={() => { setIsEditing(false); setEditedDays(member.totalDays); }} className="text-red-400 hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <span 
                onClick={() => isAdmin && setIsEditing(true)}
                className={cn(
                  "text-[10px] font-bold bg-slate-800 text-slate-400 px-2.5 py-1 rounded-lg uppercase tracking-widest flex items-center gap-1.5 transition-colors",
                  isAdmin ? "cursor-pointer hover:bg-slate-700" : "cursor-default"
                )}
              >
                {member.totalDays} Days
                {isAdmin && <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
              </span>
            )}
            {member.roomRentEnabled && (
              <span className="text-[10px] font-bold bg-indigo-950/30 text-indigo-400 px-2.5 py-1 rounded-lg uppercase tracking-widest border border-indigo-900/30">
                Rent
              </span>
            )}
            {member.messBillEnabled && (
              <span className="text-[10px] font-bold bg-emerald-950/30 text-emerald-400 px-2.5 py-1 rounded-lg uppercase tracking-widest border border-emerald-900/30">
                Mess
              </span>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between sm:justify-end gap-8">
        <div className="text-right">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-1">Payable</p>
          <p className={cn(
            "text-3xl font-display font-black tracking-tight",
            member.balance < 0 ? "text-emerald-400" : "text-indigo-500"
          )}>
            ₹{member.balance.toFixed(0)}
            <span className="text-sm font-bold ml-0.5 opacity-60">.{member.balance.toFixed(2).split('.')[1]}</span>
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <div className="flex items-center gap-2 bg-red-950/30 p-2 rounded-2xl border border-red-900/20 animate-in fade-in slide-in-from-right-2">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest px-2">Sure?</span>
                <button 
                  onClick={() => onDelete(member.id)}
                  className="p-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setConfirmDelete(false)}
                  className="p-2 bg-slate-800 text-slate-400 rounded-xl hover:bg-slate-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setConfirmDelete(true)}
                className="w-12 h-12 flex items-center justify-center text-slate-600 hover:text-red-500 hover:bg-red-950/30 rounded-2xl transition-all border border-transparent hover:border-red-900/30"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const AddPurchaseForm: React.FC<{ members: Member[], onAdd: (desc: string, amt: number, mid: string) => void | Promise<void> }> = ({ members, onAdd }) => {
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [mid, setMid] = useState('');

  return (
    <div className="bg-slate-900 p-8 rounded-4xl border border-slate-800 shadow-sm">
      <h3 className="font-display font-bold text-white mb-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-950/30 rounded-xl flex items-center justify-center">
          <ShoppingBag className="w-4 h-4 text-indigo-500" />
        </div>
        Record Purchase
      </h3>
      <div className="grid sm:grid-cols-4 gap-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Item Description</label>
          <input 
            type="text" 
            placeholder="e.g. Vegetables" 
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all text-white"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Amount (₹)</label>
          <input 
            type="number" 
            placeholder="0.00" 
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all text-white"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Buyer</label>
          <select 
            value={mid}
            onChange={(e) => setMid(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all appearance-none cursor-pointer text-white"
          >
            <option value="">Select Buyer</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button 
            onClick={() => {
              if (desc && amt && mid) {
                onAdd(desc, Number(amt), mid);
                setDesc('');
                setAmt('');
                setMid('');
              }
            }}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20"
          >
            <Plus className="w-5 h-5" />
            Add Purchase
          </button>
        </div>
      </div>
    </div>
  );
}
