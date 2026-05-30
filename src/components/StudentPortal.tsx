import { useState, useEffect } from 'react';
import { Student, TraitItem, AIServiceConfig } from '../types';
import { PRESET_TRAITS } from '../data/presets';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { generateAIConsult } from '../utils/ai';
import { 
  Sparkles, Award, ShieldAlert, BookOpen, Send, HelpCircle, 
  Heart, Check, RefreshCw, Copy, Printer, Home, ArrowRight, ArrowLeft 
} from 'lucide-react';

interface StudentPortalProps {
  apiConfig: AIServiceConfig;
  onBackToHome: () => void;
}

export default function StudentPortal({ apiConfig, onBackToHome }: StudentPortalProps) {
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

    const studentId = `student-${Date.now()}`;
    const studentPayload: Student = {
      id: studentId,
      name: name.trim(),
      selfDescription: selfDescription.trim(),
      strengths: selectedStrengths,
      weaknesses: selectedWeaknesses,
      evaluation: '', // Left blank for teacher to generate later
      feedback: '',   // Empty as AI will generate it now
      status: 'generating'
    };

    try {
      // 1. Direct Save to Firestore under subcollection classrooms/{classCode}/students/
      const studentDocRef = doc(db, 'classrooms', classCode, 'students', studentId);
      await setDoc(studentDocRef, studentPayload);

      // 2. Generate customized personal AI Growth Letter
      setLoadingStepText("AI 선생님이 마음을 가득 담아 소중한 다정다감 편지를 정성껏 적고 있습니다...");
      const rawLetter = await generateAIConsult({
        student: studentPayload,
        type: 'feedback',
        config: apiConfig
      });

      setGeneratedLetter(rawLetter);

      // 3. Save generated feedback letter back to Firestore
      studentPayload.feedback = rawLetter;
      studentPayload.status = 'completed';
      
      await setDoc(studentDocRef, studentPayload, { merge: true });

      setStep(5); // Show letter gift screen!

    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || "서버 혹은 AI 통신 장애가 발생했습니다. 잠시 후 감사하며 다시 제출해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLetter);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
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
              나의 좋은 장점과 더 키우고 싶거나 하고 싶은 이야기를 선생님에게 전하면, <br />
              나를 깊이 격려해 줄 <b>따뜻한 AI 성장 선물 편지</b>가 곧바로 찾아와요!
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-600 block">내 성함이나 이름을 기재해 주세요:</label>
            <input
              type="text"
              placeholder="예: 김민수"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm font-semibold p-3.5 border border-slate-200 bg-slate-50 rounded-xl text-center focus:outline-none focus:border-rose-400 focus:bg-white focus:ring-1 focus:ring-rose-200 transition-all text-slate-800 placeholder:text-slate-300 placeholder:font-normal"
            />
          </div>

          <button
            onClick={() => {
              if (!name.trim()) {
                alert("이름을 먼저 입력해 주셔야 시작할 수 있어요!");
                return;
              }
              setStep(2);
            }}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3.5 px-4 rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-2 transition-all"
          >
            시작하기
            <ArrowRight size={14} />
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
              {['학업/태도', '공동체/인성', '개성/역량'].map((category) => (
                <div key={category} className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{category}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TRAITS.filter(pt => pt.category === category).map((pt) => {
                      const isSelected = selectedStrengths.some(t => t.trait === pt.name);
                      return (
                        <button
                          key={pt.name}
                          onClick={() => handleToggleTrait(pt.name, 'strengths')}
                          className={`text-xs py-1.5 px-2.5 rounded-lg border cursor-pointer font-medium transition-all ${
                            isSelected 
                              ? 'bg-rose-500 border-rose-500 text-white shadow-xs font-bold' 
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {pt.name.split(" (")[0]}
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
                <span className="text-xs font-bold text-slate-705 block">선택한 강점 자부심 레벨 설정:</span>
                {selectedStrengths.map((item) => (
                  <div key={item.trait} className="bg-rose-50/40 border border-rose-100/40 p-3 rounded-xl space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-extrabold text-slate-800">{item.trait.split(" (")[0]}</span>
                      <span className="text-xs font-mono font-black text-rose-500">{item.rating}점 / 10점</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={item.rating}
                      onChange={(e) => handleUpdateRating(item.trait, parseInt(e.target.value), 'strengths')}
                      className="w-full accent-rose-500 h-1 bg-slate-100 rounded-lg appearance-auto cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setStep(1)}
              className="w-1/3 border border-slate-200 hover:bg-slate-50 text-slate-650 font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1 transition-all"
            >
              <ArrowLeft size={13} />
              이전으로
            </button>
            <button
              onClick={() => {
                if (selectedStrengths.length === 0) {
                  alert("나를 빛낼 최고의 장점을 1개 이상 꼭 선택해 주세요!");
                  return;
                }
                setStep(3);
              }}
              className="w-2/3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition-all ml-auto"
            >
              다음 단계: 보완 영역 고르기
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Weaknesses (약점 / 보완할 노력) Selection */}
      {step === 3 && (
        <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-extrabold text-rose-500 tracking-wider block uppercase">Step 3 of 4</span>
              <h3 className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-1">
                <ShieldAlert size={16} className="text-indigo-500" />
                내가 더 보완 혹은 날개 펼칠 영역 고르기
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-rose-500 bg-rose-50 px-2.5 py-1 rounded-md">{selectedWeaknesses.length}/3선택</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed bg-slate-50 p-2.5 rounded-lg">
            단점이 아닌 <b>"앞으로 노력하여 더 채우고 싶은 분야"</b>를 지정합니다. <br />
            마찬가지로 아래 목록에서 <b>1개~최대 3개</b>까지 자유롭게 체크해 보세요.
          </p>

          <div className="space-y-4">
            {/* Traits Buttons by Categories */}
            <div className="space-y-3">
              {['학업/태도', '공동체/인성', '개성/역량'].map((category) => (
                <div key={category} className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{category}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TRAITS.filter(pt => pt.category === category).map((pt) => {
                      const isSelected = selectedWeaknesses.some(t => t.trait === pt.name);
                      return (
                        <button
                          key={pt.name}
                          onClick={() => handleToggleTrait(pt.name, 'weaknesses')}
                          className={`text-xs py-1.5 px-2.5 rounded-lg border cursor-pointer font-medium transition-all ${
                            isSelected 
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs font-bold' 
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {pt.name.split(" (")[0]}
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
                  <div key={item.trait} className="bg-indigo-50/40 border border-indigo-100/40 p-3 rounded-xl space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-extrabold text-slate-800">{item.trait.split(" (")[0]}</span>
                      <span className="text-xs font-mono font-black text-indigo-600">{item.rating}점 / 10점</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={item.rating}
                      onChange={(e) => handleUpdateRating(item.trait, parseInt(e.target.value), 'weaknesses')}
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
              onClick={() => {
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
                - "학급 행사 때 앞장서서 친구들에게 의견도 많이 내고, 성실히 도우려 노력했습니다."<br />
                - "수줍음이 조금 많은 편이라 발표할 땐 떨렸지만, 수학 만큼은 정말 책임감 있게 오답도 풀었습니다."
              </span>
            </div>

            <textarea
              placeholder="여기에 자유롭게 작성해 주세요..."
              value={selfDescription}
              onChange={(e) => setSelfDescription(e.target.value)}
              rows={4}
              maxLength={200}
              className="w-full text-xs p-3.5 border border-slate-200 bg-slate-50 rounded-xl leading-relaxed focus:outline-none focus:border-rose-400 focus:bg-white focus:ring-1 focus:ring-rose-200 transition-all text-slate-800 placeholder:text-slate-300"
            />
            <div className="text-right text-[10px] text-slate-400 font-mono">
              {selfDescription.length} / 200자 제한
            </div>
          </div>

          {/* Dynamic Loading Overlay during submissions */}
          {isSubmitting ? (
            <div className="p-6 bg-rose-50/50 border border-rose-100 rounded-2xl flex flex-col items-center justify-center space-y-3.5 no-print animate-pulse">
              <RefreshCw size={24} className="text-rose-500 animate-spin" />
              <div className="text-center space-y-1">
                <span className="text-xs font-black text-rose-600 block">AI 맞춤 분석 및 편지 가공 중...</span>
                <p className="text-[10px] text-rose-500 leading-snug font-medium">{loadingStepText}</p>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setStep(3)}
                className="w-1/3 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs py-3 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-1 transition-all"
              >
                <ArrowLeft size={13} />
                이전으로
              </button>
              <button
                onClick={handleSubmitSubmission}
                className="w-2/3 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs py-3.5 px-4 rounded-xl cursor-pointer flex items-center justify-center gap-2 shadow-sm transition-all text-center"
              >
                <Send size={13} />
                의견 제출 및 따뜻한 조언 받기! 💌
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 5: Beautiful Gift Letter Opened Panel */}
      {step === 5 && (
        <div className="space-y-6 animate-fadeIn">
          {/* Virtual Letter Envelope */}
          <div className="bg-amber-50/20 border-2 border-dashed border-amber-200 rounded-2xl p-6 md:p-8 space-y-6 shadow-xs relative overflow-hidden">
            <div className="absolute top-2 right-2 flex items-center gap-1 text-[9px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full uppercase border border-amber-100">
              <Sparkles size={10} className="fill-amber-400 text-amber-500" />
              Growth Counsel
            </div>

            <div className="space-y-2 text-center pb-4 border-b border-dashed border-amber-200">
              <div className="inline-flex p-2.5 bg-rose-50 rounded-full text-rose-500">
                <Heart size={20} className="fill-rose-400 text-rose-500" />
              </div>
              <h3 className="text-base font-black text-slate-850 tracking-tight">
                💌 <b>{name}</b> 어린이에게 전하는 AI 조언 편지 선물
              </h3>
              <p className="text-[10px] text-amber-600/80 leading-normal">
                선생님이 참고하여 완성하실 따뜻한 성장의 문장이 도착했어요. 소중히 간직해 보세요!
              </p>
            </div>

            {/* Letter Content Display */}
            <div className="p-5 md:p-6 bg-white border border-amber-100/60 rounded-xl text-slate-700 text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-serif italic shadow-inner relative">
              <div className="absolute top-4 left-4 text-xs font-serif text-slate-300">"</div>
              <p className="text-slate-805 font-medium tracking-wide">
                {generatedLetter}
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
            💡 <b>소중한 한 줄 생각:</b> 이 배움 의견은 담임 선생님의 교육 데이터베이스에도 <br />
            실시간으로 기록 되었어요. 선생님께서 생활기록부 행동특성을 더욱 아름답고 <br />
            사려 깊게 다듬어 주시는 최고의 거름이 되었습니다. 오늘 하루도 수고 많았어요! 💗
          </div>

          <button
            onClick={() => {
              // Reset values & restart a new entry
              setName('');
              setSelectedStrengths([]);
              setSelectedWeaknesses([]);
              setSelfDescription('');
              setGeneratedLetter('');
              setStep(1);
            }}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-650 font-bold text-xs py-3 rounded-xl cursor-pointer text-center border border-slate-200/60 block no-print"
          >
            대기 화면으로 새로고침 (다른 학생용)
          </button>
        </div>
      )}
    </div>
  );
}
