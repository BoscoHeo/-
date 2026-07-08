import { useState, useEffect } from 'react';
import { Student, TraitItem, AIServiceConfig } from '../types';
import { PRESET_TRAITS } from '../data/presets';
import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { generateAIConsult } from '../utils/ai';
import { 
  Sparkles, Award, ShieldAlert, BookOpen, Send, HelpCircle, 
  Heart, Check, RefreshCw, Copy, Printer, Home, ArrowRight, ArrowLeft, Clock
} from 'lucide-react';

const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("localStorage getItem block protected:", e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage setItem block protected:", e);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("localStorage removeItem block protected:", e);
    }
  }
};

interface StudentPortalProps {
  apiConfig: AIServiceConfig;
  onBackToHome: () => void;
}

export default function StudentPortal({ apiConfig, onBackToHome }: StudentPortalProps) {
  // --- Active AI Config loaded from Firestore or passed as prop ---
  const [activeApiConfig, setActiveApiConfig] = useState<AIServiceConfig>(apiConfig);

  // --- Class Code States for Firestore Separation ---
  const [classCode, setClassCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('class')?.toUpperCase() || '';
  });
  const [classRoomName, setClassRoomName] = useState<string>('');
  const [isClassValid, setIsClassValid] = useState<boolean | null>(null); // null = checking, false = invalid, true = valid
  const [classInput, setClassInput] = useState<string>('');
  const [isCheckingClass, setIsCheckingClass] = useState<boolean>(false);

  // --- Step Tracking ---
  // Steps: 1 (Name & Intro), 2 (Strengths), 3 (Weaknesses), 4 (Self reflections), 5 (Submit & Letter)
  const [step, setStep] = useState<number>(1);
  
  // --- Student Input States ---
  const [name, setName] = useState('');
  const [selectedStrengths, setSelectedStrengths] = useState<TraitItem[]>([]);
  const [selectedWeaknesses, setSelectedWeaknesses] = useState<TraitItem[]>([]);
  const [selfDescription, setSelfDescription] = useState('');
  
  // --- Response States ---
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingStepText, setLoadingStepText] = useState('');
  const [generatedLetter, setGeneratedLetter] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // --- New Student Lookup & Release Verification States ---
  const [existingStudent, setExistingStudent] = useState<Student | null>(null);
  const [showExistingAlert, setShowExistingAlert] = useState<boolean>(false);
  const [isCheckingExisting, setIsCheckingExisting] = useState<boolean>(false);
  const [currentActiveStudent, setCurrentActiveStudent] = useState<Student | null>(null);

  // --- Password & Security States ---
  const [studentPassword, setStudentPassword] = useState('');
  const [passwordPrefilled, setPasswordPrefilled] = useState(false);

  // Auto-fill password if name and classCode exist in localStorage
  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed && classCode) {
      const savedPass = safeLocalStorage.getItem(`class_auth_${classCode}_${trimmed}`);
      if (savedPass) {
        setStudentPassword(savedPass);
        setPasswordPrefilled(true);
      } else {
        setPasswordPrefilled(false);
      }
    } else {
      setPasswordPrefilled(false);
    }
  }, [name, classCode]);

  // --- Effect: Validate Class Code on load or change ---
  useEffect(() => {
    if (!classCode) {
      setIsClassValid(null);
      return;
    }

    const checkClassRef = async () => {
      setIsCheckingClass(true);
      try {
        const docRef = doc(db, 'classrooms', classCode);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setClassRoomName(data.name || '우리 학급');
          setIsClassValid(true);
          if (data.apiConfig) {
            setActiveApiConfig(data.apiConfig);
          }
        } else {
          setIsClassValid(false);
        }
      } catch (err) {
        console.error("Error connecting to Firestore class document:", err);
        setIsClassValid(false);
      } finally {
        setIsCheckingClass(false);
      }
    };

    checkClassRef();
  }, [classCode]);

  // --- Helper: Toggle selection of a trait ---
  const handleToggleTrait = (traitName: string, type: 'strengths' | 'weaknesses') => {
    const currentList = type === 'strengths' ? selectedStrengths : selectedWeaknesses;
    const oppositeList = type === 'strengths' ? selectedWeaknesses : selectedStrengths;
    
    // Cannot be strength and weakness simultaneously
    if (oppositeList.some(t => t.trait === traitName)) {
      alert("같은 핵심 키워드를 동시에 강점과 약점으로 선택할 수 없습니다.");
      return;
    }

    const hasInCurrent = currentList.some(t => t.trait === traitName);
    if (hasInCurrent) {
      // Remove
      if (type === 'strengths') {
        setSelectedStrengths(prev => prev.filter(t => t.trait !== traitName));
      } else {
        setSelectedWeaknesses(prev => prev.filter(t => t.trait !== traitName));
      }
    } else {
      // Add
      if (currentList.length >= 3) {
        alert("핵심 키워드는 최대 3개까지만 고를 수 있습니다.");
        return;
      }
      const newItem: TraitItem = {
        trait: traitName,
        rating: type === 'strengths' ? 9 : 5 // Default warm assessment values
      };
      if (type === 'strengths') {
        setSelectedStrengths(prev => [...prev, newItem]);
      } else {
        setSelectedWeaknesses(prev => [...prev, newItem]);
      }
    }
  };

  const handleUpdateRating = (traitName: string, score: number, type: 'strengths' | 'weaknesses') => {
    if (type === 'strengths') {
      setSelectedStrengths(prev => prev.map(t => t.trait === traitName ? { ...t, rating: score } : t));
    } else {
      setSelectedWeaknesses(prev => prev.map(t => t.trait === traitName ? { ...t, rating: score } : t));
    }
  };

  // --- Submission Process with direct Firestore updates ---
  const handleSubmitSubmission = async () => {
    if (!name.trim()) {
      alert("이름을 꼭 기재해 주세요!");
      return;
    }
    if (selectedStrengths.length === 0) {
      alert("나의 강점 키워드를 최소 한 개 이상 골라주세요!");
      return;
    }
    if (!classCode || !isClassValid) {
      alert("참여 가능한 학급 기록방이 열려있지 않습니다.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setLoadingStepText("작성한 내용을 실시간 학급 기록실 서버에 안전하게 보관하고 있습니다...");

    const studentId = currentActiveStudent?.id || `student-${Date.now()}`;
    const studentPayload: Student = {
      id: studentId,
      name: name.trim(),
      selfDescription: selfDescription.trim(),
      strengths: selectedStrengths,
      weaknesses: selectedWeaknesses,
      evaluation: currentActiveStudent?.evaluation || '', // Keep existing teacher evaluation if editing
      feedback: '',   // Empty as AI will generate it now
      status: 'generating',
      isFeedbackSent: currentActiveStudent?.isFeedbackSent || false, // Keep sent status if editing
      password: studentPassword || '' // 저장한 비밀번호 정보
    };

    try {
      // 1. Direct Save to Firestore under subcollection classrooms/{classCode}/students/
      const studentDocRef = doc(db, 'classrooms', classCode, 'students', studentId);
      await setDoc(studentDocRef, studentPayload);

      // Save password and name locally to remember this student's ownership
      try {
        localStorage.setItem(`class_auth_${classCode}_${name.trim()}`, studentPassword);
      } catch (locErr) {
        console.warn("LocalStorage caching failed:", locErr);
      }

      // 2. Generate customized personal AI Growth Letter
      setLoadingStepText("담임 선생님이 마음을 가득 담아 소중한 다정다감 편지를 정성껏 적고 있습니다...");
      
      let rawLetter = '';
      try {
        rawLetter = await generateAIConsult({
          student: studentPayload,
          type: 'feedback',
          config: activeApiConfig
        });
      } catch (aiErr: any) {
        console.warn("AI letter generation failed but student data is saved:", aiErr);
        // Resolute elegant fallback text so the student always moves forward and doesn't get blocked
        const strList = selectedStrengths.map(s => s.trait.split(" (")[0]).join(', ');
        const weakList = selectedWeaknesses.map(w => w.trait.split(" (")[0]).join(', ');
        rawLetter = `${name.trim()}아! 이번 학기 동안 스스로를 깊이 성찰하는 성장 일지를 멋지게 적어 주었구나!\n\n네가 스스로 꼽은 큰 장점인 [${strList}]은(는) 정말 멋진 보물 같은 매력이란다. 특히 가끔은 [${weakList}]에 아쉬움이 남았다고 솔직하고 용기 있게 털어놓는 모습을 보니, 선생님은 네가 얼마나 더 멋지게 성장하고 싶어 하는 깊이 있는 아이인지 알 수 있어서 참 흐뭇하단다.\n\n네가 일지에 솔직하게 적어준 다짐처럼, 장점은 더 크게 키우고 한 치의 아쉬움도 부드럽게 이겨내는 지혜로운 발걸음을 선생님이 온 마음 다해 격려하고 힘껏 응원해 줄게! 늘 스스로를 예쁘게 가꾸어 나가는 너를 축복한단다. 화이팅! 💗`;
      }

      setGeneratedLetter(rawLetter);

      // 3. Save generated feedback letter back to Firestore
      studentPayload.feedback = rawLetter;
      studentPayload.status = 'completed';
      
      await setDoc(studentDocRef, studentPayload, { merge: true });

      setCurrentActiveStudent(studentPayload); // 상태에 저장하여 Step 5에서 발송 대기 UI가 뜰 수 있도록 함
      setStep(5); // Show letter gift screen!

    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || "서버 혹은 AI 통신 장애가 발생했습니다. 잠시 후 감사하며 다시 제출해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(generatedLetter);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } else {
        // Fallback for older browsers and in-app webviews
        const textArea = document.createElement("textarea");
        textArea.value = generatedLetter;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
    } catch (err) {
      console.error("Clipboard copy failed: ", err);
      alert("직접 편지 본문을 꾹 눌러 선택하신 뒤 복사해 주세요!");
    }
  };

  // --- UI: Select/Validate Classroom Code ---
  if (!classCode || isClassValid === false) {
    return (
      <div className="max-w-md mx-auto py-16 px-6 w-full animate-fadeIn">
        <div className="bg-white border border-slate-150 rounded-2xl p-6 md:p-8 shadow-sm space-y-6 text-center">
          <div className="inline-flex p-3 bg-rose-50 rounded-2xl text-rose-500">
            <BookOpen size={28} className="text-rose-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-slate-800 tracking-tight">🏫 내 학급 기록방 참여하기</h2>
            <p className="text-xs text-slate-400 leading-relaxed md:px-2">
              성장 편지를 작성하고 제출 내용을 담임 선생님과 실시간 공유하기 위해, 선생님께 안내받으신 <b>6자리 학급코드</b>를 적고 입장해 주세요.
            </p>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              placeholder="학급코드 입력 (예: HEO9A3)"
              maxLength={12}
              value={classInput}
              onChange={(e) => setClassInput(e.target.value.toUpperCase().trim())}
              className="w-full text-base font-bold font-mono p-3.5 border border-slate-200 bg-slate-50 rounded-xl text-center focus:outline-none focus:border-rose-400 focus:bg-white focus:ring-1 focus:ring-rose-200 uppercase tracking-widest text-slate-800"
            />
            {classCode && isClassValid === false && !isCheckingClass && (
              <p className="text-[10px] text-red-500 font-semibold">입력하신 코드가 올바르지 않거나 닫혀 있습니다. 대소문자를 확인해 보세요!</p>
            )}
          </div>

          <button
            onClick={() => {
              if (!classInput.trim()) {
                alert("선생님께 전달받은 학급코드를 기재해 주세요!");
                return;
              }
              setClassCode(classInput.trim().toUpperCase());
            }}
            disabled={isCheckingClass}
            className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs py-3.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
          >
            {isCheckingClass ? '학급 기록방 정보 확인 중...' : '학급 입장하여 자기평가 시작하기'}
            <ArrowRight size={14} />
          </button>

          <button
            onClick={onBackToHome}
            className="text-xs text-slate-400 hover:text-slate-600 font-semibold cursor-pointer block mx-auto underline mt-2"
          >
            처음 화면으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  // --- New Handler: Start or Check Existing Student Record ---
  const handleStartOrCheck = async () => {
    if (!name.trim()) {
      alert("이름을 먼저 입력해 주셔야 시작할 수 있어요!");
      return;
    }
    if (studentPassword.length !== 4) {
      alert("나만의 간단 비밀번호 숫자 4자리를 정확히 입력해 주세요! (나중에 내 활동 및 편지를 나만 볼 수 있도록 안전하게 지켜줍니다 🔐)");
      return;
    }
    
    setIsCheckingExisting(true);
    setErrorMessage(null);
    try {
      // Query if this name already exists in classroom students subcollection
      const q = query(
        collection(db, 'classrooms', classCode, 'students'),
        where('name', '==', name.trim())
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        // Found existing student record!
        const docData = querySnapshot.docs[0].data() as Student;
        
        // Determine if they have actually written/submitted anything (strengths or selfDescription filled)
        const hasSubmittedContent = 
          (docData.strengths && docData.strengths.length > 0) || 
          (docData.weaknesses && docData.weaknesses.length > 0) || 
          (docData.selfDescription && docData.selfDescription.trim().length > 0);

        if (!hasSubmittedContent) {
          // Case A: Pre-registered student by teacher or completely empty draft (first login)
          // Secure with the entered password if they didn't have one set yet
          if (!docData.password) {
            const studentDocRef = doc(db, 'classrooms', classCode, 'students', docData.id);
            await setDoc(studentDocRef, { password: studentPassword }, { merge: true });
            docData.password = studentPassword;
          } else if (docData.password !== studentPassword) {
            // If they did have a password set somehow, enforce it
            setErrorMessage("⚠️ 비밀번호 오류: 입력한 비밀번호가 등록된 이름의 정보와 일치하지 않습니다. 설정하신 정확한 4자리 숫자를 입력해 주세요. (비밀번호를 모르겠다면 담임 선생님의 대시보드 화면에서도 손쉽게 조회가 가능합니다)");
            setIsCheckingExisting(false);
            return;
          }

          // Directly go to Step 2 without showing any confusing "already exists" alerts!
          setCurrentActiveStudent(docData);
          setExistingStudent(docData);
          setSelectedStrengths([]);
          setSelectedWeaknesses([]);
          setSelfDescription('');
          setShowExistingAlert(false);
          setStep(2);
          
          // Save password and name locally to remember this student's ownership
          safeLocalStorage.setItem(`class_auth_${classCode}_${name.trim()}`, studentPassword);
        } else {
          // Case B: They have actually written/submitted content before.
          if (!docData.password) {
            // Legacy student without password - set it now and show options
            const studentDocRef = doc(db, 'classrooms', classCode, 'students', docData.id);
            const updatedStudent = { ...docData, password: studentPassword };
            await setDoc(studentDocRef, { password: studentPassword }, { merge: true });
            
            setExistingStudent(updatedStudent);
            setCurrentActiveStudent(updatedStudent);
            setShowExistingAlert(true);
            safeLocalStorage.setItem(`class_auth_${classCode}_${name.trim()}`, studentPassword);
          } else if (docData.password !== studentPassword) {
            // Password mismatch! Protect individual privacy
            setErrorMessage("⚠️ 비밀번호 오류: 입력한 비밀번호가 등록된 이름의 정보와 일치하지 않습니다. 다른 사람과 이름이 겹친다면 이름 끝에 학년 반(예: 김민수6_3)을 덧붙여 새로 작성하거나, 설정하신 정확한 4자리 숫자를 입력해 주세요. (비밀번호를 모르겠다면 담임 선생님의 대시보드 화면에서도 손쉽게 조회가 가능합니다)");
            setExistingStudent(null);
            setCurrentActiveStudent(null);
            setShowExistingAlert(false);
          } else {
            // Password matched! Allow opening or editing
            setExistingStudent(docData);
            setCurrentActiveStudent(docData);
            setShowExistingAlert(true);
            safeLocalStorage.setItem(`class_auth_${classCode}_${name.trim()}`, studentPassword);
          }
        }
      } else {
        // No existing record, proceed to step 2 safely as a new student
        const studentId = `student-${Date.now()}`;
        const tempStudent: Student = {
          id: studentId,
          name: name.trim(),
          selfDescription: '',
          strengths: [],
          weaknesses: [],
          evaluation: '',
          feedback: '',
          status: 'idle', // 'idle'로 시작하여 작성 중임을 표시
          isFeedbackSent: false,
          password: studentPassword
        };

        // 즉시 Firestore에 저장하여 실시간 대시보드에 학생 이름이 나타나도록 함!
        const studentDocRef = doc(db, 'classrooms', classCode, 'students', studentId);
        await setDoc(studentDocRef, tempStudent);

        safeLocalStorage.setItem(`class_auth_${classCode}_${name.trim()}`, studentPassword);

        setShowExistingAlert(false);
        setExistingStudent(null);
        setCurrentActiveStudent(tempStudent);
        setSelectedStrengths([]);
        setSelectedWeaknesses([]);
        setSelfDescription('');
        setStep(2);
      }
    } catch (err: any) {
      console.warn("Error checking existing student, proceeding directly:", err);
      // Fallback: just proceed
      setStep(2);
    } finally {
      setIsCheckingExisting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-8 px-4 w-full">
      {/* Upper Mode Header */}
      <div className="flex justify-between items-center mb-6 no-print">
        <button
          onClick={onBackToHome}
          className="flex items-center gap-1 text-slate-400 hover:text-slate-800 text-xs font-semibold bg-white border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer"
        >
          <Home size={13} />
          처음 화면으로
        </button>
        <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-100 px-2.5 py-1 rounded-full text-[10px] font-bold text-rose-600">
          <Heart size={10} className="fill-rose-500 animate-pulse text-rose-500" />
          <span>{classRoomName} ({classCode}) 자가조사 및 성장 편지역</span>
        </div>
      </div>

      {/* Progress Line */}
      {step < 5 && (
        <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden mb-8 no-print">
          <div 
            className="bg-rose-500 h-full transition-all duration-300" 
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-semibold space-y-2">
          <p>{errorMessage}</p>
          <button 
            onClick={() => setErrorMessage(null)} 
            className="underline block cursor-pointer"
          >
            확인 및 닫기
          </button>
        </div>
      )}

      {/* Step 1: Greeting & Name Registration */}
      {step === 1 && (
        <div className="bg-white border border-slate-150 rounded-2xl p-6 md:p-8 shadow-sm space-y-6">
          <div className="space-y-2 text-center">
            <div className="inline-flex p-3 bg-rose-50 rounded-2xl text-rose-500">
              <Heart size={28} className="fill-rose-100 text-rose-500" />
            </div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">지혜로운 성장을 돕는 자기조사방</h2>
            <p className="text-xs text-slate-400 md:px-4 leading-relaxed">
              안녕하세요! <b>[{classRoomName}]</b> 기록방에 참여했습니다.<br />
              나의 소중한 장점과 학기 다짐을 적어 선생님께 전하고, <br />
              나중에 <b>이름과 나만의 비밀번호 4자리</b>를 치고 다시 들어오면 <br />
              선생님이 보내주신 <b>따뜻한 다정다감 격려 편지💌</b>를 나 혼자서 안전하게 열어볼 수 있답니다!
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-600 block">내 성함이나 이름을 기재해 주세요:</label>
              <input
                type="text"
                placeholder="예: 김민수"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setShowExistingAlert(false);
                  setExistingStudent(null);
                }}
                disabled={isCheckingExisting}
                className="w-full text-sm font-semibold p-3.5 border border-slate-200 bg-slate-50 rounded-xl text-center focus:outline-none focus:border-rose-400 focus:bg-white focus:ring-1 focus:ring-rose-200 transition-all text-slate-800 placeholder:text-slate-300 placeholder:font-normal disabled:opacity-60"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-600 block">나만의 4자리 비밀번호 (숫자):</label>
                {passwordPrefilled && (
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-0.5 animate-fadeIn">
                    🔐 기기에 기억됨
                  </span>
                )}
              </div>
              <input
                type="password"
                maxLength={4}
                pattern="[0-9]*"
                inputMode="numeric"
                placeholder="예: 1234 (나중에 내 편지를 조회할 때 열쇠가 됩니다)"
                value={studentPassword}
                onChange={(e) => {
                  setStudentPassword(e.target.value.replace(/[^0-9]/g, ''));
                }}
                disabled={isCheckingExisting}
                className="w-full text-sm font-bold font-mono p-3.5 border border-slate-200 bg-slate-50 rounded-xl text-center focus:outline-none focus:border-rose-400 focus:bg-white focus:ring-1 focus:ring-rose-200 transition-all text-slate-800 tracking-widest disabled:opacity-60"
              />
              <p className="text-[10px] text-slate-400 text-left pl-1 leading-normal">
                💡 <b>숫자 4자리</b>를 지정해 두면, 이 기기에서 내 자가진단 기록과 선생님 조언 편지를 안전하게 혼자서만 확인해볼 수 있습니다.
              </p>
            </div>

            {/* Existing Student Alert Indicator */}
            {showExistingAlert && existingStudent && (
              <div className="p-4 bg-indigo-50/70 border border-indigo-150 rounded-xl space-y-3 animate-fadeIn text-left">
                <div className="flex items-center gap-2 text-indigo-900">
                  <Clock size={15} className="text-indigo-600 animate-pulse shrink-0" />
                  <p className="text-xs font-extrabold font-sans">
                    [{existingStudent.name}] 어린이의 작성 기록이 있습니다!
                  </p>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed leading-normal">
                  이미 조사 성찰지를 제출한 이력이 존재합니다. 선생님께서 발송해 주신 사랑의 격려 편지를 확인하시려면 <b>[📬 선생님 편지함 열기]</b>를, 이전에 썼던 내용을 확인·수정하거나 다시 작성하시려면 <b>[📝 작성 내용 수정 / 이어서 쓰기]</b>를 클릭하세요.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 font-semibold pt-1">
                  <button
                    onClick={() => {
                      setGeneratedLetter(existingStudent.feedback || '');
                      setSelectedStrengths(existingStudent.strengths || []);
                      setSelectedWeaknesses(existingStudent.weaknesses || []);
                      setSelfDescription(existingStudent.selfDescription || '');
                      setCurrentActiveStudent(existingStudent);
                      setStep(5);
                    }}
                    className="flex-1 bg-indigo-650 hover:bg-indigo-700 text-white text-[10px] py-2 px-2.5 rounded-lg text-center cursor-pointer transition-all font-bold shadow-xs flex items-center justify-center gap-1"
                  >
                    📬 선생님 편지함 열기
                  </button>
                  <button
                    onClick={() => {
                      setSelectedStrengths(existingStudent.strengths || []);
                      setSelectedWeaknesses(existingStudent.weaknesses || []);
                      setSelfDescription(existingStudent.selfDescription || '');
                      setCurrentActiveStudent(existingStudent);
                      setShowExistingAlert(false);
                      setStep(2);
                    }}
                    className="flex-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 text-[10px] py-2 px-2.5 rounded-lg text-center cursor-pointer transition-all font-bold flex items-center justify-center gap-1"
                  >
                    📝 작성 내용 수정 / 이어서 쓰기
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleStartOrCheck}
            disabled={isCheckingExisting}
            className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs py-3.5 px-4 rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-2 transition-all"
          >
            {isCheckingExisting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                기록 대조 및 성찰실 입장 중...
              </>
            ) : (
              <>
                시작하기
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 2: Strengths (장점) Selection */}
      {step === 2 && (
        <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-extrabold text-rose-500 tracking-wider block uppercase">Step 2 of 4</span>
              <h3 className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-1">
                <Award size={16} className="text-yellow-500" />
                나의 대표적인 최고의 강점(장점) 고르기
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-rose-500 bg-rose-50 px-2.5 py-1 rounded-md">{selectedStrengths.length}/3선택</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed bg-slate-50 p-2.5 rounded-lg">
            친구들이나 스스로 생각하기에 나에게 가장 어울리는 장점을 <b>최대 3개</b> 골라주세요. <br />
            아래 태그를 먼저 선택한 뒤 슬라이더를 조정하여 얼마나 어울리는지 표현해 보세요!
          </p>

          <div className="space-y-4">
            {/* Traits Buttons by Categories */}
            <div className="space-y-3">
              {['생활', '인성', '학습'].map((category) => (
                <div key={category} className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{category}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TRAITS.filter(pt => pt.category === category).map((pt) => {
                      const isSelected = selectedStrengths.some(t => t?.trait === pt?.name);
                      return (
                        <button
                          key={pt?.name || 'trait'}
                          onClick={() => handleToggleTrait(pt?.name, 'strengths')}
                          className={`text-xs py-1.5 px-2.5 rounded-lg border cursor-pointer font-medium transition-all ${
                            isSelected 
                              ? 'bg-rose-500 border-rose-500 text-white shadow-xs font-bold' 
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {pt?.name?.split(" (")[0] || ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Selected Sliders */}
            {selectedStrengths.length > 0 && (
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <span className="text-xs font-bold text-slate-700 block">설정 레벨 (높을수록 더욱 어울리는 나의 강점이에요!):</span>
                {selectedStrengths.map((item) => (
                  <div key={item?.trait || 'trait'} className="bg-rose-50/40 border border-rose-100/40 p-3 rounded-xl space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-extrabold text-slate-800">{item?.trait?.split(" (")[0] || ""}</span>
                      <span className="text-xs font-mono font-black text-rose-600">{item?.rating}점 / 10점</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={item?.rating || 9}
                      onChange={(e) => handleUpdateRating(item?.trait, parseInt(e.target.value), 'strengths')}
                      className="w-full accent-rose-600 h-1 bg-slate-100 rounded-lg appearance-auto cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setStep(1)}
              className="w-1/3 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1 transition-all"
            >
              <ArrowLeft size={13} />
              이전으로
            </button>
            <button
              onClick={async () => {
                // 실시간 수집 및 데이터 무결성을 위해 다음 버튼 클릭 시 현재까지 작성된 장점을 Firestore에 자동 업로드
                try {
                  const sId = currentActiveStudent?.id;
                  if (sId && classCode) {
                    const studentDocRef = doc(db, 'classrooms', classCode, 'students', sId);
                    await setDoc(studentDocRef, {
                      strengths: selectedStrengths
                    }, { merge: true });
                    setCurrentActiveStudent(prev => prev ? { ...prev, strengths: selectedStrengths } : null);
                  }
                } catch (err) {
                  console.warn("Auto save strengths failed:", err);
                }
                setStep(3);
              }}
              className="w-2/3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition-all ml-auto"
            >
              다음 단계: 나의 아쉬운 점 고르기
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Weaknesses (아쉬운 점 / 개선할 점) Selection */}
      {step === 3 && (
        <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6 animate-fadeIn">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-extrabold text-indigo-500 tracking-wider block uppercase">Step 3 of 4</span>
              <h3 className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-1">
                <ShieldAlert size={16} className="text-indigo-500" />
                나의 아쉬웠거나 더 노력하고 싶은 점 고르기
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-md">{selectedWeaknesses.length}/3선택</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed bg-slate-50 p-2.5 rounded-lg">
            이번 학기 동안 조금 아쉬웠거나 혹은 다음 학기에 더 채워가고 싶은 요소를 <b>최대 3개</b> 골라주세요. <br />
            아래 태그를 선택한 뒤 슬라이더로 자신에게 조절할 수 있습니다 (점수가 작을수록 더 많은 노력이 필요해요).
          </p>

          <div className="space-y-4">
            {/* Traits Buttons by Categories */}
            <div className="space-y-3">
              {['생활', '인성', '학습'].map((category) => (
                <div key={category} className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{category}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TRAITS.filter(pt => pt.category === category).map((pt) => {
                      const isSelected = selectedWeaknesses.some(t => t?.trait === pt?.name);
                      return (
                        <button
                          key={pt?.name || 'trait'}
                          onClick={() => handleToggleTrait(pt?.name, 'weaknesses')}
                          className={`text-xs py-1.5 px-2.5 rounded-lg border cursor-pointer font-medium transition-all ${
                            isSelected 
                              ? 'bg-indigo-500 border-indigo-500 text-white shadow-xs font-bold' 
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {pt?.name?.split(" (")[0] || ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Selected Sliders */}
            {selectedWeaknesses.length > 0 && (
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <span className="text-xs font-bold text-slate-700 block">설정 레벨 (낮을수록 더욱 극복 노력이 필요해요!):</span>
                {selectedWeaknesses.map((item) => (
                  <div key={item?.trait || 'trait'} className="bg-indigo-50/40 border border-indigo-100/40 p-3 rounded-xl space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-extrabold text-slate-800">{item?.trait?.split(" (")[0] || ""}</span>
                      <span className="text-xs font-mono font-black text-indigo-600">{item?.rating}점 / 10점</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={item?.rating || 5}
                      onChange={(e) => handleUpdateRating(item?.trait, parseInt(e.target.value), 'weaknesses')}
                      className="w-full accent-indigo-600 h-1 bg-slate-100 rounded-lg appearance-auto cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setStep(2)}
              className="w-1/3 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1 transition-all"
            >
              <ArrowLeft size={13} />
              이전으로
            </button>
            <button
              onClick={async () => {
                // 실시간 수집 및 데이터 무결성을 위해 다음 버튼 클릭 시 현재까지 작성된 아쉬운 점을 Firestore에 자동 업로드
                try {
                  const sId = currentActiveStudent?.id;
                  if (sId && classCode) {
                    const studentDocRef = doc(db, 'classrooms', classCode, 'students', sId);
                    await setDoc(studentDocRef, {
                      weaknesses: selectedWeaknesses
                    }, { merge: true });
                    setCurrentActiveStudent(prev => prev ? { ...prev, weaknesses: selectedWeaknesses } : null);
                  }
                } catch (err) {
                  console.warn("Auto save weaknesses failed:", err);
                }
                setStep(4);
              }}
              className="w-2/3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition-all ml-auto"
            >
              다음 단계: 나의 자기평가 쓰기
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Self Reflection (자기평가 의견) & Submission Area */}
      {step === 4 && (
        <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <span className="text-[10px] font-extrabold text-rose-500 tracking-wider block uppercase">Step 4 of 4</span>
            <h3 className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-1.5">
              <BookOpen size={16} className="text-rose-500" />
              나를 스스로 돌아보는 한 문장 일지 (자기평가)
            </h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600 block text-slate-650">
                학기 동안 스스로 보람찬 일, 뿌듯했거나 더 잘하고 싶었던 다짐을 솔직하게 적어주세요.
              </label>
              <span className="text-[10px] text-slate-400 leading-normal block italic bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                🌱 <b>작성 도움 예시:</b><br />
                - "학급 친구들을 배려하며 다툼 없이 지내려 노력했고, 다음 학기에는 수학 공부와 발표에 조금 더 용기를 내고 싶습니다."
              </span>
            </div>

            <textarea
              rows={4}
              placeholder="여기에 생각이나 다짐을 자유롭게 적어 보세요. (최소 5자 이상)"
              value={selfDescription}
              onChange={(e) => setSelfDescription(e.target.value)}
              disabled={isSubmitting}
              className="w-full text-xs p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:outline-none focus:border-rose-400 focus:bg-white focus:ring-1 focus:ring-rose-200 transition-all text-slate-800 placeholder:text-slate-350 resize-y"
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setStep(3)}
              disabled={isSubmitting}
              className="w-1/3 border border-slate-200 hover:bg-slate-50 text-slate-650 font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1 transition-all"
            >
              <ArrowLeft size={13} />
              이전으로
            </button>
            <button
              onClick={handleSubmitSubmission}
              disabled={isSubmitting}
              className="w-2/3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition-all ml-auto"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  제출 및 마음 편지 제작 중...
                </>
              ) : (
                <>
                  작성 완료 및 제출하기
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Beautiful Gift Letter Opened Panel */}
      {step === 5 && (
        <div className="space-y-6 animate-fadeIn">
          {currentActiveStudent?.isFeedbackSent !== true ? (
            /* Pending/Waiting Release State Card */
            <div className="bg-white border border-slate-150 rounded-2xl p-6 md:p-8 shadow-sm space-y-6 text-center animate-fadeIn">
              <div className="inline-flex p-3.5 bg-indigo-50 rounded-full text-indigo-500 animate-pulse">
                <Clock size={28} className="text-indigo-600" />
              </div>
               <div className="space-y-2">
                <h3 className="text-lg font-black text-slate-800 tracking-tight">📝 나를 위한 성장 일지 작성 완료!</h3>
                <p className="text-xs text-slate-500 leading-relaxed md:px-4 leading-normal">
                  <b>{name || currentActiveStudent?.name}</b> 어린이의 생각 일기와 장단점 기록은 <br />
                  담임 선생님의 소중한 생각 기록함으로 아주 안전하게 도착했습니다.
                </p>
                <div className="bg-slate-50 border border-slate-150 p-4 rounded-xl text-left mt-4 text-xs text-slate-600 leading-relaxed space-y-2.5">
                  <p className="font-bold text-slate-700 text-center pb-2 border-b border-slate-200/80 mb-1 flex items-center justify-center gap-1">
                    <span>💌</span> 다음 과정에 장점 편지가 탄생해요!
                  </p>
                  <p>1. <b>담임 선생님</b>께서 어린이 마다의 개성과 강점을 축복하는 따뜻한 격려 편지를 소중히 준비하고 계십니다.</p>
                  <p>2. 선생님께서 너의 성찰을 읽어보시고 <b>'인정(전송)'</b>을 누르시면, 학생은 이곳에 다시 들어와 바로 편지를 선물로 품에 안을 수 있어요!</p>
                  <p>3. 전송이 완료된 후에는 <b>자기 이름으로 다시 입장</b>하시면, 언제든지 예쁘게 설계된 편지를 저장하고 인쇄해 간직할 수 있습니다.</p>
                </div>
              </div>

              <div className="pt-2">
                <div className="p-3 bg-indigo-50 border border-indigo-100/50 rounded-xl text-[11px] text-indigo-700 font-bold flex items-center justify-center gap-1.5 shadow-inner">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                  <span>선생님이 마음을 실어 전송해 주실 때까지 조금만 설레며 기다려주세요! (발송 대기중 ✉️)</span>
                </div>
              </div>

              <button
                onClick={() => {
                  setName('');
                  setSelectedStrengths([]);
                  setSelectedWeaknesses([]);
                  setSelfDescription('');
                  setGeneratedLetter('');
                  setCurrentActiveStudent(null);
                  setStep(1);
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-3 rounded-xl transition-all cursor-pointer border border-slate-200"
              >
                대기 화면으로 돌아가기 (처음으로)
              </button>
            </div>
          ) : (
            /* Virtual Letter Envelope - Actually Released! */
            <>
              <div className="bg-amber-50/20 border-2 border-dashed border-amber-200 rounded-2xl p-6 md:p-8 space-y-6 shadow-xs relative overflow-hidden">
                <div className="absolute top-2 right-2 flex items-center gap-1 text-[9px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full uppercase border border-amber-100 animate-pulse">
                  <Sparkles size={10} className="fill-amber-400 text-amber-500" />
                  Released Growth Letter
                </div>

                <div className="space-y-2 text-center pb-4 border-b border-dashed border-amber-200">
                  <div className="inline-flex p-2.5 bg-rose-50 rounded-full text-rose-500">
                    <Heart size={20} className="fill-rose-400 text-rose-500 animate-bounce" />
                  </div>
                  <h3 className="text-base font-black text-slate-850 tracking-tight">
                    💌 <b>{name || currentActiveStudent?.name}</b> 학생에게 전하는 담임 선생님의 따뜻한 마음 편지 선물
                  </h3>
                  <p className="text-[10px] text-amber-600/80 leading-normal">
                    선생님이 확인하시고 사랑을 듬뿍 담아 발송해 주신 성장 편지에요. 따스히 품어보세요!
                  </p>
                </div>

                {/* Letter Content Display */}
                <div className="p-5 md:p-6 bg-white border border-amber-100/60 rounded-xl text-slate-700 text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-serif italic shadow-inner relative">
                  <div className="absolute top-4 left-4 text-xs font-serif text-slate-300">"</div>
                  <p className="text-slate-855 font-medium tracking-wide">
                    {generatedLetter || currentActiveStudent?.feedback}
                  </p>
                  <div className="absolute bottom-4 right-4 text-xs font-serif text-slate-300">"</div>
                </div>

                {/* Actions for the student */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-dashed border-amber-200 no-print">
                  <button
                    onClick={copyToClipboard}
                    className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 font-bold text-xs px-3.5 py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Copy size={13} />
                    {copySuccess ? '클립보드에 복사 완료!' : '편지 문구 복사하기'}
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition-all"
                  >
                    <Printer size={13} />
                    종이 편지로 출력 (Print)
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-xl text-slate-500 text-[10px] md:text-xs leading-relaxed text-center no-print">
                💡 <b>스스로 가꾸는 예쁜 마음:</b> 나를 돌아보는 이 소중한 생각들은 나의 한 해 성장 일지에 차곡차곡 모이며,<br />
                선생님이 너를 더 깊이 이해하고 사랑 가득 담아 다정하게 격려해주는 데 소중한 보배가 된단다. 화이팅! 💗
              </div>

              <button
                onClick={() => {
                  setName('');
                  setSelectedStrengths([]);
                  setSelectedWeaknesses([]);
                  setSelfDescription('');
                  setGeneratedLetter('');
                  setCurrentActiveStudent(null);
                  setStep(1);
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-3 rounded-xl cursor-pointer text-center border border-slate-200/60 block no-print"
              >
                대기 화면으로 새로고침 (다른 학생용)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
