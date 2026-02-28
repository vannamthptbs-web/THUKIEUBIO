
import React, { useState, useEffect } from 'react';
import { AppState, Question, QuizResult, Student } from './types';
import { getAIFeedback } from './services/geminiService';
import { saveToGoogleSheets, getHistory, getSheetUrl, saveSheetUrl, fetchHistoryFromSheet } from './services/sheetService';
import { ACCOUNTS } from './data/accounts';
import { BIOLOGY_QUESTIONS } from './data/biologyData';

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppState>(AppState.LOGIN);
  const [student, setStudent] = useState<Student | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<QuizResult | null>(null);
  const [history, setHistory] = useState<QuizResult[]>([]);
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [tempSheetUrl, setTempSheetUrl] = useState(getSheetUrl());
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);

  // State cho đổi mật khẩu
  const [pwdForm, setPwdForm] = useState({ old: '', new: '', confirm: '' });
  const [pwdStatus, setPwdStatus] = useState({ message: '', isError: false });

  const MAX_ATTEMPTS = 5;

  useEffect(() => {
    // Tải dữ liệu ban đầu
    loadLeaderboard();
  }, []);

  useEffect(() => {
    if (currentStep === AppState.LOGIN || currentStep === AppState.QUIZ_SELECTION) {
      loadLeaderboard();
    }
  }, [currentStep]);

  const loadLeaderboard = async () => {
    setIsLeaderboardLoading(true);
    try {
      const data = await fetchHistoryFromSheet();
      setHistory(data);
    } finally {
      setIsLeaderboardLoading(false);
    }
  };

  // Tính tổng điểm tích lũy và số lần làm của học sinh hiện tại
  const getStudentStats = (studentId: string) => {
    const studentAttempts = history.filter(h => h.studentId === studentId);
    const totalScore = studentAttempts.reduce((sum, h) => {
      const s = typeof h.score === 'string' ? parseFloat(h.score) : h.score;
      return sum + s;
    }, 0);
    return {
      count: studentAttempts.length,
      totalScore: totalScore
    };
  };

  const getStoredPassword = (studentId: string) => {
    return localStorage.getItem(`pwd_${studentId}`);
  };

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError("");
    const formData = new FormData(e.currentTarget);
    const id = formData.get('studentId') as string;
    const password = formData.get('password') as string;

    const matchedAccount = ACCOUNTS.find(acc => acc.id === id);
    
    if (matchedAccount) {
      const customPwd = getStoredPassword(id);
      const validPwd = customPwd || matchedAccount.password;

      if (password === validPwd) {
        setStudent({ name: matchedAccount.name, id: matchedAccount.id });
        setCurrentStep(AppState.QUIZ_SELECTION);
      } else {
        setLoginError("Mật khẩu không chính xác!");
      }
    } else {
      setLoginError("Mã học sinh không tồn tại!");
    }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwdStatus({ message: '', isError: false });
    if (!student) return;
    const matchedAccount = ACCOUNTS.find(acc => acc.id === student.id);
    const currentValidPwd = getStoredPassword(student.id) || matchedAccount?.password;
    if (pwdForm.old !== currentValidPwd) {
      setPwdStatus({ message: 'Mật khẩu cũ không đúng!', isError: true });
      return;
    }
    if (pwdForm.new.length < 4) {
      setPwdStatus({ message: 'Mật khẩu mới phải có ít nhất 4 ký tự!', isError: true });
      return;
    }
    if (pwdForm.new !== pwdForm.confirm) {
      setPwdStatus({ message: 'Xác nhận mật khẩu mới không khớp!', isError: true });
      return;
    }
    localStorage.setItem(`pwd_${student.id}`, pwdForm.new);
    setPwdStatus({ message: 'Đổi mật khẩu thành công!', isError: false });
    setPwdForm({ old: '', new: '', confirm: '' });
    setTimeout(() => {
      setCurrentStep(AppState.QUIZ_SELECTION);
      setPwdStatus({ message: '', isError: false });
    }, 1500);
  };

  const startQuiz = () => {
    if (!student) return;
    if (BIOLOGY_QUESTIONS.length === 0) {
      alert("Hiện tại chưa có câu hỏi nào trong hệ thống. Vui lòng cập nhật câu hỏi!");
      return;
    }
    const stats = getStudentStats(student.id);
    if (stats.count >= MAX_ATTEMPTS) {
      alert(`Bạn đã hoàn thành tối đa ${MAX_ATTEMPTS} lần làm bài!`);
      return;
    }

    setLoading(true);
    const shuffled = [...BIOLOGY_QUESTIONS].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(20, BIOLOGY_QUESTIONS.length));
    setTimeout(() => {
      setQuestions(selected);
      setCurrentQuestionIndex(0);
      setAnswers({});
      setCurrentStep(AppState.TAKING_QUIZ);
      setLoading(false);
    }, 800);
  };

  const submitAnswer = (optionIndex: number) => {
    const currentQ = questions[currentQuestionIndex];
    const newAnswers = { ...answers, [currentQ.id]: optionIndex };
    setAnswers(newAnswers);
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      finishQuiz(newAnswers);
    }
  };

  const finishQuiz = async (finalAnswers: Record<string, number>) => {
    setLoading(true);
    try {
      let weightedScore = 0;
      let correctCount = 0;
      questions.forEach(q => {
        if (finalAnswers[q.id] === q.correctAnswer) {
          weightedScore += 2;
          correctCount++;
        } else {
          weightedScore -= 0.5;
        }
      });

      const result: QuizResult = {
        studentName: student?.name || 'Unknown',
        studentId: student?.id || '000',
        score: weightedScore,
        correctCount: correctCount,
        totalQuestions: questions.length,
        timestamp: new Date().toLocaleString('vi-VN'),
        answers: finalAnswers
      };

      const feedback = await getAIFeedback(result, questions);
      result.aiFeedback = feedback;

      // Lưu lên Google Sheets
      await saveToGoogleSheets(result);
      
      setLastResult(result);
      setCurrentStep(AppState.RESULTS);
      // Tải lại bảng vàng ngay sau khi có kết quả mới
      await loadLeaderboard();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = () => {
    if (tempSheetUrl.trim() === "") {
      alert("Vui lòng nhập link Google Sheet!");
      return;
    }
    saveSheetUrl(tempSheetUrl);
    // Sau khi lưu, tải lại bảng vàng ngay lập tức
    loadLeaderboard();
    alert("Đã lưu cấu hình và đang đồng bộ dữ liệu...");
    setCurrentStep(AppState.LOGIN);
  };

  const getAggregatedLeaderboard = () => {
    const groups: Record<string, { name: string, id: string, totalScore: number, attempts: number }> = {};
    
    history.forEach(item => {
      if (!groups[item.studentId]) {
        groups[item.studentId] = { name: item.studentName, id: item.studentId, totalScore: 0, attempts: 0 };
      }
      const s = typeof item.score === 'string' ? parseFloat(item.score) : item.score;
      groups[item.studentId].totalScore += s;
      groups[item.studentId].attempts += 1;
    });

    return Object.values(groups).sort((a, b) => b.totalScore - a.totalScore);
  };

  const LeaderboardContent = () => {
    const aggregatedData = getAggregatedLeaderboard();
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <i className="fas fa-crown text-amber-500"></i> BẢNG VÀNG
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {isLeaderboardLoading ? 'Đang đồng bộ...' : 'Tổng điểm tích lũy'}
            </p>
          </div>
          <button onClick={loadLeaderboard} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors">
            <i className={`fas fa-sync-alt ${isLeaderboardLoading ? 'animate-spin' : ''}`}></i>
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-2 custom-scrollbar max-h-[500px]">
          {aggregatedData.length > 0 ? (
            aggregatedData.map((res, i) => (
              <div key={res.id} className="bg-white p-4 rounded-2xl flex items-center justify-between border border-slate-100 hover:shadow-lg transition-all group animate-in slide-in-from-right duration-300">
                <div className="flex items-center gap-3">
                   <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm ${i === 0 ? 'bg-amber-400 text-white shadow-lg' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-300 text-white' : 'bg-slate-50 text-slate-400'}`}>
                      {i + 1}
                   </div>
                   <div>
                      <p className="font-bold text-slate-800 text-sm truncate max-w-[120px]">{res.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{res.id}</p>
                        <span className="text-[8px] bg-indigo-50 text-indigo-500 px-1.5 rounded-full font-black uppercase">
                          {res.attempts} lượt
                        </span>
                      </div>
                   </div>
                </div>
                <div className="text-right">
                   <p className="text-lg font-black text-indigo-600 leading-none">{res.totalScore.toFixed(1)}<span className="text-[10px] ml-0.5">đ</span></p>
                </div>
              </div>
            ))
          ) : (
            <div className="py-20 text-center opacity-30">
               <i className="fas fa-cloud-download-alt text-4xl mb-2"></i>
               <p className="text-xs font-black uppercase">Chưa có dữ liệu tích lũy</p>
               {tempSheetUrl === "" && <p className="text-[8px] text-red-500 mt-2 font-black uppercase">Vui lòng cài đặt link Sheet</p>}
            </div>
          )}
        </div>
      </div>
    );
  };

  const studentStats = student ? getStudentStats(student.id) : { count: 0, totalScore: 0 };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#f8fafc] overflow-x-hidden font-sans">
      <div className="w-full max-w-5xl mb-6 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 p-3 rounded-2xl shadow-xl rotate-3">
            <i className="fas fa-dna text-white text-2xl"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none uppercase">Sinh học 4.0</h1>
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mt-1">Tác giả: Cô Kiều Thị Kim Thu - THPT Dương Xá</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
           <button onClick={() => setCurrentStep(AppState.SETTINGS)} className="w-10 h-10 rounded-xl bg-white shadow-sm border border-slate-200 text-slate-400 hover:text-indigo-600 transition-all flex items-center justify-center">
             <i className="fas fa-cog text-lg"></i>
           </button>
           {student && (
              <div className="flex items-center gap-2">
                <div className="bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[9px] text-slate-400 font-black uppercase">Học sinh</p>
                    <p className="text-xs font-bold text-slate-700">{student.name}</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                    <i className="fas fa-user text-xs"></i>
                  </div>
                </div>
              </div>
           )}
        </div>
      </div>

      <main className={`w-full ${currentStep === AppState.LOGIN ? 'max-w-5xl' : 'max-w-2xl'} transition-all duration-500`}>
        {loading ? (
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-20 text-center border border-slate-100">
            <div className="w-20 h-20 border-8 border-indigo-50 border-t-indigo-600 rounded-full animate-spin mx-auto mb-8"></div>
            <h2 className="text-2xl font-black text-slate-800">Đang đồng bộ...</h2>
            <p className="text-slate-500 mt-2">Dữ liệu đang được cập nhật lên Google Sheet</p>
          </div>
        ) : (
          <>
            {currentStep === AppState.LOGIN && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-7 bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-10 flex flex-col justify-center animate-in fade-in duration-500">
                  <div className="mb-10">
                    <h2 className="text-4xl font-black text-slate-800 mb-2">Đăng nhập</h2>
                    <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">
                       Trạng thái hệ thống: {getSheetUrl() ? '🟢 Đã kết nối' : '🔴 Chưa cấu hình'}
                    </p>
                  </div>
                  
                  <form onSubmit={handleLogin} className="space-y-6">
                    {loginError && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border-l-4 border-red-500">{loginError}</div>}
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase ml-2">Mã Học Sinh</label>
                      <input name="studentId" required className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-indigo-600 focus:bg-white outline-none transition-all font-bold text-lg" placeholder="HS001" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase ml-2">Mật khẩu</label>
                      <div className="relative">
                        <input name="password" type={showPassword ? "text" : "password"} required className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-indigo-600 focus:bg-white outline-none transition-all font-bold text-lg" placeholder="••••••••" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300">
                          <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                        </button>
                      </div>
                    </div>
                    <button className="w-full bg-slate-900 hover:bg-black text-white font-black py-5 rounded-2xl shadow-2xl transition-all transform hover:-translate-y-1 text-lg">
                      VÀO HÀNH TRÌNH TRI THỨC
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-5 bg-slate-100 rounded-[2.5rem] p-8 border border-slate-200 shadow-inner">
                  <LeaderboardContent />
                </div>
              </div>
            )}

            {currentStep === AppState.SETTINGS && (
              <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 border border-slate-100 max-w-2xl mx-auto animate-in zoom-in duration-300">
                <button onClick={() => student ? setCurrentStep(AppState.QUIZ_SELECTION) : setCurrentStep(AppState.LOGIN)} className="mb-6 text-slate-400 font-bold flex items-center gap-2">
                   <i className="fas fa-arrow-left"></i> Quay lại
                </button>
                <div className="space-y-8">
                  <div>
                    <h2 className="text-3xl font-black text-slate-800 mb-2">Cấu hình Hệ thống</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase">Lưu link Web App để đồng bộ kết quả tích lũy</p>
                  </div>
                  
                  <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100">
                    <p className="text-amber-800 text-xs font-bold leading-relaxed flex gap-2">
                      <i className="fas fa-info-circle mt-1"></i>
                      <span>Ứng dụng yêu cầu link Google Script (Web App) để lưu điểm vĩnh viễn và cộng dồn tối đa 5 lần làm bài.</span>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase ml-2">Link Google Script (Web App URL)</label>
                    <textarea 
                      value={tempSheetUrl} 
                      onChange={(e) => setTempSheetUrl(e.target.value)} 
                      className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-2 border-slate-200 h-32 font-mono text-xs focus:border-indigo-600 outline-none transition-all" 
                      placeholder="https://script.google.com/macros/s/.../exec" 
                    />
                  </div>
                  <button onClick={handleSaveSettings} className="w-full bg-indigo-600 text-white font-black py-5 rounded-2xl shadow-xl hover:bg-indigo-700 transition-all transform hover:-translate-y-1">
                    CẬP NHẬT LINK SHEET
                  </button>
                </div>
              </div>
            )}

            {currentStep === AppState.CHANGE_PASSWORD && (
              <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 border border-slate-100 max-w-2xl mx-auto animate-in zoom-in duration-300">
                <button onClick={() => setCurrentStep(AppState.QUIZ_SELECTION)} className="mb-6 text-slate-400 font-bold flex items-center gap-2">
                   <i className="fas fa-arrow-left"></i> Quay lại
                </button>
                <div className="space-y-8">
                  <div>
                    <h2 className="text-3xl font-black text-slate-800 mb-2">Đổi mật khẩu</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase">Cập nhật mật khẩu cá nhân của bạn</p>
                  </div>

                  {pwdStatus.message && (
                    <div className={`p-4 rounded-2xl text-sm font-bold border-l-4 ${pwdStatus.isError ? 'bg-red-50 text-red-600 border-red-500' : 'bg-green-50 text-green-600 border-green-500'}`}>
                      {pwdStatus.message}
                    </div>
                  )}

                  <form onSubmit={handleChangePassword} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase ml-2">Mật khẩu cũ</label>
                      <input 
                        type="password" 
                        required 
                        value={pwdForm.old}
                        onChange={(e) => setPwdForm({...pwdForm, old: e.target.value})}
                        className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-indigo-600 focus:bg-white outline-none transition-all font-bold" 
                        placeholder="••••••••" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase ml-2">Mật khẩu mới</label>
                      <input 
                        type="password" 
                        required 
                        value={pwdForm.new}
                        onChange={(e) => setPwdForm({...pwdForm, new: e.target.value})}
                        className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-indigo-600 focus:bg-white outline-none transition-all font-bold" 
                        placeholder="••••••••" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase ml-2">Xác nhận mật khẩu mới</label>
                      <input 
                        type="password" 
                        required 
                        value={pwdForm.confirm}
                        onChange={(e) => setPwdForm({...pwdForm, confirm: e.target.value})}
                        className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-indigo-600 focus:bg-white outline-none transition-all font-bold" 
                        placeholder="••••••••" 
                      />
                    </div>
                    <button className="w-full bg-slate-900 hover:bg-black text-white font-black py-5 rounded-2xl shadow-2xl transition-all transform hover:-translate-y-1 text-lg">
                      XÁC NHẬN ĐỔI MẬT KHẨU
                    </button>
                  </form>
                </div>
              </div>
            )}

            {currentStep === AppState.QUIZ_SELECTION && (
               <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 text-center border border-slate-100 animate-in zoom-in duration-300">
                <h2 className="text-3xl font-black text-slate-800 mb-6">Chào {student?.name}!</h2>

                <div className="grid grid-cols-2 gap-4 mb-8">
                   <div className="p-6 rounded-3xl bg-indigo-50 border-2 border-indigo-100">
                      <p className="text-[10px] font-black uppercase text-indigo-400 mb-1">Tiến độ làm bài</p>
                      <p className="text-4xl font-black text-indigo-600">{studentStats.count} / {MAX_ATTEMPTS}</p>
                   </div>
                   <div className="p-6 rounded-3xl bg-amber-50 border-2 border-amber-100">
                      <p className="text-[10px] font-black uppercase text-amber-400 mb-1">Tổng điểm cộng dồn</p>
                      <p className="text-4xl font-black text-amber-600">{studentStats.totalScore.toFixed(1)}đ</p>
                   </div>
                </div>

                <button 
                  onClick={startQuiz} 
                  disabled={studentStats.count >= MAX_ATTEMPTS}
                  className={`w-full font-black py-5 rounded-3xl shadow-xl text-lg transition-all transform active:scale-95 ${
                    studentStats.count >= MAX_ATTEMPTS 
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100'
                  }`}
                >
                  {studentStats.count >= MAX_ATTEMPTS ? 'BẠN ĐÃ HẾT LƯỢT LÀM BÀI' : 'BẮT ĐẦU LÀM BÀI MỚI'}
                </button>
                
                <div className="mt-8 flex items-center justify-center gap-4">
                  <button onClick={() => setCurrentStep(AppState.SETTINGS)} className="text-[10px] font-black text-slate-400 uppercase hover:text-indigo-600">Cấu hình Sheet</button>
                  <span className="text-slate-200">|</span>
                  <button onClick={() => setCurrentStep(AppState.CHANGE_PASSWORD)} className="text-[10px] font-black text-slate-400 uppercase hover:text-indigo-600">Đổi mật khẩu</button>
                  <span className="text-slate-200">|</span>
                  <button onClick={() => { setStudent(null); setCurrentStep(AppState.LOGIN); }} className="text-[10px] font-black text-slate-400 uppercase hover:text-red-500">Đăng xuất</button>
                </div>
              </div>
            )}

            {currentStep === AppState.TAKING_QUIZ && (
              <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 border border-slate-100 animate-in fade-in duration-300">
                <div className="flex items-center justify-between mb-10">
                  <div className="px-6 py-2 bg-slate-900 rounded-2xl text-white font-black text-xs">Câu {currentQuestionIndex + 1} / 20</div>
                  <div className="h-2 flex-1 mx-8 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 transition-all duration-500" style={{width: `${((currentQuestionIndex+1)/20)*100}%`}}></div>
                  </div>
                </div>
                <h2 className="text-2xl font-black text-slate-800 mb-10 leading-tight">{questions[currentQuestionIndex]?.question}</h2>
                <div className="space-y-4">
                  {questions[currentQuestionIndex]?.options.map((option, idx) => (
                    <button key={idx} onClick={() => submitAnswer(idx)} className="w-full text-left p-6 rounded-3xl border-2 border-slate-50 hover:border-indigo-600 hover:bg-indigo-50 transition-all flex items-center gap-5 group">
                      <span className="w-12 h-12 flex-shrink-0 rounded-2xl bg-slate-100 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center font-black text-slate-400 transition-all text-xl shadow-sm">{String.fromCharCode(65 + idx)}</span>
                      <span className="font-bold text-slate-700 text-lg leading-snug">{option}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentStep === AppState.RESULTS && lastResult && (
              <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 border border-slate-100 animate-in slide-in-from-bottom duration-500">
                <div className="text-center mb-10">
                  <div className="w-20 h-20 bg-green-500 text-white rounded-[2rem] flex items-center justify-center text-3xl mx-auto mb-6 shadow-xl rotate-12 animate-bounce"><i className="fas fa-check"></i></div>
                  <h2 className="text-4xl font-black text-slate-800 uppercase">KẾT QUẢ</h2>
                  <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2 italic">Hệ thống đang cộng dồn điểm tích lũy...</p>
                </div>
                
                <div className="grid grid-cols-2 gap-6 mb-10">
                   <div className="bg-slate-900 p-8 rounded-[2.5rem] text-center shadow-2xl">
                     <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Lần này</p>
                     <p className="text-5xl font-black text-white">{lastResult.score.toFixed(1)}</p>
                   </div>
                   <div className="bg-indigo-50 p-8 rounded-[2.5rem] text-center border-2 border-indigo-100">
                     <p className="text-[10px] font-black text-indigo-400 uppercase mb-1">Tổng tích lũy mới</p>
                     <p className="text-5xl font-black text-indigo-600">{(studentStats.totalScore + lastResult.score).toFixed(1)}</p>
                   </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-[2rem] p-8 mb-10">
                    <div className="flex items-center gap-2 mb-3">
                      <i className="fas fa-robot text-indigo-600 text-sm"></i>
                      <span className="text-[10px] font-black text-slate-400 uppercase">Phân tích chuyên sâu từ AI</span>
                    </div>
                    <p className="text-slate-700 font-bold italic leading-relaxed">"{lastResult.aiFeedback}"</p>
                </div>

                {/* Incorrect Questions Section */}
                <div className="mb-10">
                  <h3 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-6">
                    <i className="fas fa-exclamation-circle text-red-500"></i> CÁC CÂU CẦN XEM LẠI
                  </h3>
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {questions.map((q, idx) => {
                      const studentAnswer = lastResult.answers[q.id];
                      if (studentAnswer !== q.correctAnswer) {
                        return (
                          <div key={q.id} className="bg-red-50 p-6 rounded-[2rem] border border-red-100 animate-in fade-in duration-300">
                            <p className="text-[10px] font-black text-red-400 uppercase mb-2">Câu {idx + 1}</p>
                            <p className="font-bold text-slate-800 mb-4 leading-tight">{q.question}</p>
                            <div className="space-y-2">
                              <div className="flex items-start gap-3 text-sm">
                                <span className="mt-0.5 w-12 flex-shrink-0 px-2 py-0.5 rounded-lg bg-red-200 text-red-600 font-black text-[9px] text-center uppercase">Bạn chọn</span>
                                <span className="text-slate-600 font-medium">{q.options[studentAnswer] || "Chưa trả lời"}</span>
                              </div>
                              <div className="flex items-start gap-3 text-sm">
                                <span className="mt-0.5 w-12 flex-shrink-0 px-2 py-0.5 rounded-lg bg-green-200 text-green-600 font-black text-[9px] text-center uppercase">Đáp án</span>
                                <span className="text-slate-800 font-bold">{q.options[q.correctAnswer]}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                    {questions.every(q => lastResult.answers[q.id] === q.correctAnswer) && (
                      <div className="py-10 text-center">
                        <i className="fas fa-star text-amber-400 text-3xl mb-3"></i>
                        <p className="text-slate-400 font-bold italic">Tuyệt vời! Bạn không làm sai câu nào.</p>
                      </div>
                    )}
                  </div>
                </div>
                
                <button 
                  onClick={() => { setCurrentStep(AppState.QUIZ_SELECTION); loadLeaderboard(); }} 
                  className="w-full bg-slate-900 text-white font-black py-5 rounded-3xl shadow-xl text-lg transform hover:-translate-y-1 transition-all"
                >
                  XEM QUỸ ĐIỂM TỔNG HỢP
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <footer className="mt-12 text-center pb-10 font-bold text-[10px] text-slate-400 uppercase tracking-[0.2em] leading-loose">
        Sinh học 4.0 - Tác giả: Cô Kiều Thị Kim Thu - THPT Dương Xá <br/>
        <span className="text-[8px] opacity-50">Hệ thống đồng bộ điểm tích lũy thông minh v4.0</span>
      </footer>
    </div>
  );
};

export default App;
