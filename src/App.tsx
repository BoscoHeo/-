import { useState, useEffect, FormEvent, MouseEvent } from 'react';
import { Student, AIServiceConfig, TraitItem } from './types';
import { SAMPLE_STUDENTS, PRESET_TRAITS } from './data/presets';
import { 
  Plus, Settings, Database, Trash2, Download, RefreshCw, 
  HelpCircle, Sparkles, FileText, Upload, Printer, AlertTriangle, Play,
  Copy, Check, UserCheck, Users, HelpCircle as HelpIcon, ArrowRight, Heart,
  LogOut, Home, Lock
} from 'lucide-react';
import AIPresentation from './components/AIPresentation';
import SettingsModal from './components/SettingsModal';
import ExcelPasteModal from './components/ExcelPasteModal';
import StudentPortal from './components/StudentPortal';

// Direct Firebase cloud connection
import { db } from './firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { generateAIConsult } from './utils/ai';

export default function App() {
  // --- Mode State ---
  const [appMode, setAppMode] = useState<'selection' | 'teacher' | 'student'>('selection');

  // --- Classroom Management States ---
  const [classCode, setClassCode] = useState<string>(() => localStorage.getItem('teacher_class_code') || '');
  const [className, setClassName] = useState<string>(() => localStorage.getItem('teacher_class_name') || '');
  const [classPassword, setClassPassword] = useState<string>(() => localStorage.getItem('teacher_class_password') || '');
  const [tempClassName, setTempClassName] = useState('');
  const [tempClassCode, setTempClassCode] = useState('');
  const [tempCreatePassword, setTempCreatePassword] = useState('');
  const [tempLoginPassword, setTempLoginPassword] = useState('');
  const [recentClasses, setRecentClasses] = useState<{ code: string; name: string; }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('teacher_class_history') || '[]');
    } catch {
      return [];
    }
  });

  // --- Core States ---
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<AIServiceConfig>({ service: 'built-in' });
  
  // --- UI Control States ---
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  const [showCopyUrlTip, setShowCopyUrlTip] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // --- Temporary Form States for Adding Students ---
  const [newStudentName, setNewStudentName] = useState('');

  // --- Local Persistence & Init ---
  useEffect(() => {
    // 1. Detect app mode from query parameter or localStorage
    const params = new URLSearchParams(window.location.search);
    const queryMode = params.get('mode');
    const queryClass = params.get('class');
    
    if (queryMode === 'student') {
      setAppMode('student');
    } else if (queryMode === 'teacher') {
      setAppMode('teacher');
    } else {
      const storedMode = localStorage.getItem('applet_app_mode') as 'selection' | 'teacher' | 'student' | null;
      if (storedMode) {
        setAppMode(storedMode);
      } else {
        setAppMode('selection');
      }
    }

    if (queryClass) {
      setClassCode(queryClass.toUpperCase());
      localStorage.setItem('teacher_class_code', queryClass.toUpperCase());
    }

    // 2. Load config from localstorage
    const savedConfig = localStorage.getItem('ai_evaluator_config');
    if (savedConfig) {
      try {
        setApiConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error('Error parsing config', e);
      }
    }
  }, []);

  // Synchronize active classroom apiConfig on boot or code loading
  useEffect(() => {
    if (!classCode) return;
    const fetchClassroomConfig = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'classrooms', classCode));
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.apiConfig) {
            setApiConfig(data.apiConfig);
            localStorage.setItem('ai_evaluator_config', JSON.stringify(data.apiConfig));
          }
          if (data.password) {
            setClassPassword(data.password);
            localStorage.setItem('teacher_class_password', data.password);
            localStorage.setItem(`teacher_pwd_for_${classCode}`, data.password);
          }
        }
      } catch (err) {
        console.error("Error loading classroom config from Firestore:", err);
      }
    };
    fetchClassroomConfig();
  }, [classCode]);

  // Sync state to LocalStorage for offline cache convenience
  useEffect(() => {
    if (students.length > 0) {
      localStorage.setItem('ai_evaluator_students', JSON.stringify(students));
    }
  }, [students]);

  // Real-time Cloud Streaming via onSnapshot (No polling necessary!)
  useEffect(() => {
    if (appMode !== 'teacher' || !classCode) return;

    const studentsCollectionRef = collection(db, 'classrooms', classCode, 'students');
    
    const unsubscribe = onSnapshot(studentsCollectionRef, (snapshot) => {
      const dbStudents: Student[] = [];
      snapshot.forEach((doc) => {
        dbStudents.push(doc.data() as Student);
      });
      
      // Sort students alphabetically
      dbStudents.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      setStudents(dbStudents);
      
      // Select first student if nothing is selected yet
      if (dbStudents.length > 0) {
        setSelectedStudentId(prev => {
          if (!prev || !dbStudents.some(s => s.id === prev)) {
            return dbStudents[0].id;
          }
          return prev;
        });
      } else {
        setSelectedStudentId(null);
      }
    }, (error) => {
      console.error("Firestore real-time subscription error:", error);
    });

    return () => unsubscribe();
  }, [appMode, classCode]);

  const handleManualSync = async () => {
    if (!classCode) return;
    setIsSyncing(true);
    try {
      const studentsCollectionRef = collection(db, 'classrooms', classCode, 'students');
      const qSnap = await getDocs(studentsCollectionRef);
      const dbStudents: Student[] = [];
      qSnap.forEach((docSnap) => {
        dbStudents.push(docSnap.data() as Student);
      });
      
      dbStudents.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      setStudents(dbStudents);
      
      if (dbStudents.length > 0) {
        setSelectedStudentId(prev => {
          if (!prev || !dbStudents.some(s => s.id === prev)) {
            return dbStudents[0].id;
          }
          return prev;
        });
      } else {
        setSelectedStudentId(null);
      }
      alert(`클라우드 학급 보관소 실시간 강제 수집 성공! 현재까지 제출을 마친 ${dbStudents.length}명의 모든 데이터가 완벽 동기화되었습니다.`);
    } catch (err: any) {
      console.error("Manual sync error:", err);
      alert(`데이터 동기화 실패: ${err.message || '네트워크를 점검해 보세요.'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Classroom handler helpers
  const handleCreateClassroom = async () => {
    if (!tempClassName.trim()) {
      alert("개설하실 학급 명칭을 적어주세요!");
      return;
    }
    if (!tempCreatePassword.trim()) {
      alert("교사용 기록방 비밀번호를 꼭 설정해 주세요! (비밀번호를 설정하여 학생들이 다른 선생님이나 본인 학급의 전체 일지 데이터베이스에 비인가 접근하는 것을 완전히 차단합니다 🔐)");
      return;
    }

    // Generate random 6 characters code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    try {
      await setDoc(doc(db, 'classrooms', code), {
        code,
        name: tempClassName.trim(),
        createdAt: new Date().toISOString(),
        apiConfig: apiConfig,
        password: tempCreatePassword.trim() // 교사용 관리 비밀번호 저장
      });

      setClassCode(code);
      setClassName(tempClassName.trim());
      setClassPassword(tempCreatePassword.trim());
      localStorage.setItem('teacher_class_code', code);
      localStorage.setItem('teacher_class_name', tempClassName.trim());
      localStorage.setItem('teacher_class_password', tempCreatePassword.trim());
      localStorage.setItem(`teacher_pwd_for_${code}`, tempCreatePassword.trim());

      // Update history list
      const updatedHistory = [{ code, name: tempClassName.trim() }, ...recentClasses.filter(c => c.code !== code)].slice(0, 10);
      setRecentClasses(updatedHistory);
      localStorage.setItem('teacher_class_history', JSON.stringify(updatedHistory));
      
      setTempClassName('');
      setTempCreatePassword('');
      setTempLoginPassword('');

    } catch (err) {
      console.error("Error creating classroom in Firestore:", err);
      alert("기록실 개설 중 오류가 발생했습니다. 네트워크 환경을 점검해 보세요.");
    }
  };

  const handleEnterClassroom = async () => {
    if (!tempClassCode.trim()) {
      alert("진입하실 6자리 코드를 기재해 주십시오.");
      return;
    }
    const enteredCode = tempClassCode.toUpperCase();

    try {
      const docSnap = await getDoc(doc(db, 'classrooms', enteredCode));
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // 비밀번호 대조
        const savedPassword = data.password;
        if (savedPassword) {
          if (savedPassword !== tempLoginPassword.trim()) {
            alert("❌ 비밀번호 오류: 기재하신 교사용 관리 비밀번호가 일치하지 않습니다. 해당 학급의 기록방 방장 선생님이 정하신 고유 관리 열쇠를 정확히 입력해 주세요!");
            return;
          }
        }
        
        const rName = data.name || '우리 학급';
        
        setClassCode(enteredCode);
        setClassName(rName);
        if (savedPassword) {
          setClassPassword(savedPassword);
          localStorage.setItem('teacher_class_password', savedPassword);
          localStorage.setItem(`teacher_pwd_for_${enteredCode}`, savedPassword);
        } else {
          setClassPassword('');
          localStorage.removeItem('teacher_class_password');
        }
        localStorage.setItem('teacher_class_code', enteredCode);
        localStorage.setItem('teacher_class_name', rName);

        if (data.apiConfig) {
          setApiConfig(data.apiConfig);
          localStorage.setItem('ai_evaluator_config', JSON.stringify(data.apiConfig));
        }

        // Update history list
        const updatedHistory = [{ code: enteredCode, name: rName }, ...recentClasses.filter(c => c.code !== enteredCode)].slice(0, 10);
        setRecentClasses(updatedHistory);
        localStorage.setItem('teacher_class_history', JSON.stringify(updatedHistory));
        setTempClassCode('');
        setTempLoginPassword('');
      } else {
        alert("입력하신 고유코드에 해당하는 활성화된 기록실이 없습니다. 명확한 코드를 재확인해 보세요!");
      }
    } catch (err) {
      console.error("Error entering classroom in Firestore:", err);
      alert("학급 입장 중 오류가 발생했습니다.");
    }
  };

  const handleEnterRecentClassroom = async (code: string, name: string) => {
    try {
      const docSnap = await getDoc(doc(db, 'classrooms', code));
      if (docSnap.exists()) {
        const data = docSnap.data();
        const savedPassword = data.password;
        const localPwd = localStorage.getItem(`teacher_pwd_for_${code}`) || '';
        
        if (savedPassword && savedPassword !== localPwd) {
          // If password mismatch, redirect to entry form
          setTempClassCode(code);
          setTempLoginPassword('');
          alert("🔒 이 기록실은 교사용 보안 비밀번호 설정이 적용되어 있습니다. 아래 입장 칸에 해당 기록방의 교사용 비밀번호를 기입하여 로그인해 주세요!");
          
          // Scroll or focus class code entry block
          const optElement = document.getElementById("existing_room_password_input");
          if (optElement) {
            optElement.focus();
          }
          return;
        }

        setClassCode(code);
        setClassName(data.name || name);
        if (savedPassword) {
          setClassPassword(savedPassword);
          localStorage.setItem('teacher_class_password', savedPassword);
          localStorage.setItem(`teacher_pwd_for_${code}`, savedPassword);
        } else {
          setClassPassword('');
          localStorage.removeItem('teacher_class_password');
        }
        localStorage.setItem('teacher_class_code', code);
        localStorage.setItem('teacher_class_name', data.name || name);
        
        if (data.apiConfig) {
          setApiConfig(data.apiConfig);
          localStorage.setItem('ai_evaluator_config', JSON.stringify(data.apiConfig));
        }
      } else {
        alert("해당 기록실이 원격 데이터베이스에 존재하지 않습니다.");
      }
    } catch (err) {
      console.error("Recent classroom access error:", err);
      setTempClassCode(code);
      alert("원격 서버에서 기록실 보안 정보를 대조하지 못했습니다. 아래 입력창에서 비밀번호를 기재하여 재입장을 추진해 주세요.");
    }
  };

  const activeStudent = students.find(s => s.id === selectedStudentId);

  // --- Action Handlers ---

  // Add individual student
  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim()) return;

    const studentId = `student-${Date.now()}`;
    const newStudent: Student = {
      id: studentId,
      name: newStudentName.trim(),
      selfDescription: '',
      strengths: [],
      weaknesses: [],
      evaluation: '',
      feedback: '',
      status: 'idle'
    };

    if (classCode) {
      try {
        await setDoc(doc(db, 'classrooms', classCode, 'students', studentId), newStudent);
        setSelectedStudentId(studentId);
        setNewStudentName('');
      } catch (err) {
        console.error("Error writing student to Firestore:", err);
      }
    } else {
      const updated = [...students, newStudent];
      setStudents(updated);
      setSelectedStudentId(studentId);
      setNewStudentName('');
    }
  };

  // Delete student
  const handleDeleteStudent = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    
    if (classCode) {
      try {
        await deleteDoc(doc(db, 'classrooms', classCode, 'students', id));
        if (selectedStudentId === id) {
          setSelectedStudentId(null);
        }
      } catch (err) {
        console.error("Error deleting student from Firestore:", err);
      }
    } else {
      const updated = students.filter(s => s.id !== id);
      setStudents(updated);
      if (selectedStudentId === id) {
        setSelectedStudentId(updated.length > 0 ? updated[0].id : null);
      }
    }
  };

  // Trait rating / editing
  const handleUpdateStudentTraits = async (studentId: string, payload: {
    name?: string;
    selfDescription?: string;
    strengths?: TraitItem[];
    weaknesses?: TraitItem[];
    password?: string;
  }) => {
    if (classCode) {
      try {
        await setDoc(doc(db, 'classrooms', classCode, 'students', studentId), {
          ...payload,
          status: 'idle'
        }, { merge: true });
      } catch (err) {
        console.error("Error updating student traits in Firestore:", err);
      }
    } else {
      setStudents(prev => prev.map(s => {
        if (s.id === studentId) {
          return { ...s, ...payload, status: 'idle' };
        }
        return s;
      }));
    }
  };

  // Add a specific trait to Strength or Weakness
  const handleAddTraitToStudent = (studentId: string, traitName: string, type: 'strengths' | 'weaknesses') => {
    const studentObj = students.find(s => s.id === studentId);
    if (!studentObj) return;

    const traitList = type === 'strengths' ? [...studentObj.strengths] : [...studentObj.weaknesses];
    
    // Prevent duplicate traits
    if (traitList.some(item => item.trait === traitName)) return;

    const newItem: TraitItem = {
      trait: traitName,
      rating: type === 'strengths' ? 9 : 5 // default ratings
    };

    handleUpdateStudentTraits(studentId, {
      [type]: [...traitList, newItem]
    });
  };

  // Remove a trait from student
  const handleRemoveTraitFromStudent = (studentId: string, traitName: string, type: 'strengths' | 'weaknesses') => {
    const studentObj = students.find(s => s.id === studentId);
    if (!studentObj) return;

    const filtered = (type === 'strengths' ? studentObj.strengths : studentObj.weaknesses)
      .filter(item => item.trait !== traitName);

    handleUpdateStudentTraits(studentId, {
      [type]: filtered
    });
  };

  // Edit trait rating score slider
  const handleUpdateTraitRating = (studentId: string, traitName: string, score: number, type: 'strengths' | 'weaknesses') => {
    const studentObj = students.find(s => s.id === studentId);
    if (!studentObj) return;

    const updatedList = (type === 'strengths' ? studentObj.strengths : studentObj.weaknesses).map(item => {
      if (item.trait === traitName) {
        return { ...item, rating: score };
      }
      return item;
    });

    handleUpdateStudentTraits(studentId, {
      [type]: updatedList
    });
  };

  // Save specific content adjustments from AIPresentation
  const handleUpdateContent = async (studentId: string, evaluation: string, feedback: string) => {
    if (classCode) {
      try {
        await setDoc(doc(db, 'classrooms', classCode, 'students', studentId), {
          evaluation,
          feedback,
          status: 'completed' as const
        }, { merge: true });
      } catch (err) {
        console.error("Error saving edits to Firestore:", err);
      }
    } else {
      setStudents(prev => prev.map(s => {
        if (s.id === studentId) {
          return { ...s, evaluation, feedback, status: 'completed' as const };
        }
        return s;
      }));
    }
  };

  // Toggle release state of AI growth letter to the student
  const handleToggleFeedbackSent = async (studentId: string) => {
    if (classCode) {
      const studentObj = students.find(s => s.id === studentId);
      if (!studentObj) return;
      const newSentStatus = !studentObj.isFeedbackSent;
      try {
        await setDoc(doc(db, 'classrooms', classCode, 'students', studentId), {
          isFeedbackSent: newSentStatus
        }, { merge: true });
        
        // Update local list state optimistically
        setStudents(prev => prev.map(s => s.id === studentId ? { ...s, isFeedbackSent: newSentStatus } : s));
      } catch (err) {
        console.error("Error toggling feedback sent status in Firestore:", err);
      }
    } else {
      setStudents(prev => prev.map(s => {
        if (s.id === studentId) {
          return { ...s, isFeedbackSent: !s.isFeedbackSent };
        }
        return s;
      }));
    }
  };

  // Single Generation Request API triggers
  const handleGenerateSingle = async (type: 'evaluation' | 'feedback') => {
    if (!activeStudent) return;

    // Set student status to generating
    if (classCode) {
      await setDoc(doc(db, 'classrooms', classCode, 'students', activeStudent.id), { status: 'generating' }, { merge: true });
    } else {
      setStudents(prev => prev.map(s => s.id === activeStudent.id ? { ...s, status: 'generating' } : s));
    }

    try {
      const rawResult = await generateAIConsult({
        student: activeStudent,
        type,
        config: apiConfig
      });

      if (classCode) {
        await setDoc(doc(db, 'classrooms', classCode, 'students', activeStudent.id), {
          [type]: rawResult,
          status: 'completed' as const,
          errorMsg: null
        }, { merge: true });
      } else {
        setStudents(prev => prev.map(s => {
          if (s.id === activeStudent.id) {
            return {
              ...s,
              [type]: rawResult,
              status: 'completed' as const,
              errorMsg: undefined
            };
          }
          return s;
        }));
      }

    } catch (err: any) {
      console.error(err);
      if (classCode) {
        await setDoc(doc(db, 'classrooms', classCode, 'students', activeStudent.id), {
          status: 'error' as const,
          errorMsg: err.message || '인증 오류가 발생했습니다.'
        }, { merge: true });
      } else {
        setStudents(prev => prev.map(s => {
          if (s.id === activeStudent.id) {
            return {
              ...s,
              status: 'error' as const,
              errorMsg: err.message || '인증 오류가 발생했습니다.'
            };
          }
          return s;
        }));
      }
    }
  };

  // Bulk / Batch Generate for all students (Sequential sleep to prevent API 429 limits)
  const handleBatchGenerateAll = async () => {
    if (students.length === 0) return;
    
    const confirmRun = window.confirm(
      `학급 전체 학생 ${students.length}명에 대하여 생활기록부 평가문 및 상담조언을 순차 일괄생성하시겠습니까?\n(AI 처리 환경에 따라 약 수십초~수 분이 소요될 수 있습니다.)`
    );
    if (!confirmRun) return;

    setIsBatchGenerating(true);
    setBatchProgress({ current: 0, total: students.length });

    // Iterate through students
    for (let i = 0; i < students.length; i++) {
      const target = students[i];
      setBatchProgress({ current: i + 1, total: students.length });

      // Update student status to generating
      if (classCode) {
        await setDoc(doc(db, 'classrooms', classCode, 'students', target.id), { status: 'generating' }, { merge: true });
      } else {
        setStudents(prev => prev.map(s => s.id === target.id ? { ...s, status: 'generating' } : s));
      }

      try {
        // 1. Generate Evaluation Report (행동특성 종합의견)
        const finalEval = await generateAIConsult({
          student: target,
          type: 'evaluation',
          config: apiConfig
        }).catch(err => `[평가 오류]: ${err.message || '생성 실패'}`);

        // Polite delay (Sleep 1.1s) to prevent API throttling rate limit blocks
        await new Promise(r => setTimeout(r, 1100));

        // 2. Generate Advice Feedback (상담 피드백)
        const finalFeedback = await generateAIConsult({
          student: target,
          type: 'feedback',
          config: apiConfig
        }).catch(err => `[상담 오류]: ${err.message || '생성 실패'}`);

        // Save progress back to state
        if (classCode) {
          const isErrorStatus = finalEval.startsWith('[평가 오류]') || finalFeedback.startsWith('[상담 오류]');
          await setDoc(doc(db, 'classrooms', classCode, 'students', target.id), {
            evaluation: finalEval,
            feedback: finalFeedback,
            status: isErrorStatus ? 'error' as const : 'completed' as const,
            errorMsg: isErrorStatus ? '일부 생성 에러가 기재되었습니다.' : null
          }, { merge: true });
        } else {
          setStudents(prev => prev.map(s => {
            if (s.id === target.id) {
              const isErrorStatus = finalEval.startsWith('[평가 오류]') || finalFeedback.startsWith('[상담 오류]');
              return {
                ...s,
                evaluation: finalEval,
                feedback: finalFeedback,
                status: isErrorStatus ? 'error' as const : 'completed' as const,
                errorMsg: isErrorStatus ? '일부 생성 에러가 기재되었습니다.' : undefined
              };
            }
            return s;
          }));
        }

        // Final cool-down delay
        await new Promise(r => setTimeout(r, 800));

      } catch (err: any) {
        console.error('Batch error for student', target.name, err);
        if (classCode) {
          await setDoc(doc(db, 'classrooms', classCode, 'students', target.id), {
            status: 'error' as const,
            errorMsg: err.message || '일괄 생성 처리 오류'
          }, { merge: true });
        } else {
          setStudents(prev => prev.map(s => s.id === target.id ? { 
            ...s, 
            status: 'error' as const, 
            errorMsg: err.message || '일괄 생성 처리 오류' 
          } : s));
        }
      }
    }

    setIsBatchGenerating(false);
    alert('학급 일괄 평가문 작성이 완료되었습니다! 결과를 확인하고 수정하세요.');
  };

  // Spreadsheet Paste Import handler
  const handleImportStudents = async (newStudents: Student[]) => {
    if (classCode) {
      try {
        const batch = writeBatch(db);
        newStudents.forEach(student => {
          const docRef = doc(db, 'classrooms', classCode, 'students', student.id);
          batch.set(docRef, student);
        });
        await batch.commit();
        if (newStudents.length > 0) {
          setSelectedStudentId(newStudents[0].id);
        }
      } catch (err) {
        console.error("Error bulk uploading imported students:", err);
        alert("일괄 업로드 저장 도중 에러가 발생했습니다.");
      }
    } else {
      const updated = [...students, ...newStudents];
      setStudents(updated);
      if (newStudents.length > 0) {
        setSelectedStudentId(newStudents[0].id);
      }
    }
  };

  // Export to CSV spreadsheet
  const handleExportCSV = () => {
    if (students.length === 0) return;
    
    // Prepare header (UTF-8 BOM prefix for Korean characters in Excel)
    let csvContent = "\uFEFF";
    csvContent += "이름,자기평가,강점 설정,약점 설정,생활기록부 행동특성 종합의견,다정다감 상담 피드백\n";

    students.forEach(student => {
      const escape = (text: string) => `"${(text || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
      const strengthsStr = student.strengths.map(s => `${s.trait}(${s.rating}점)`).join('; ');
      const weaknessesStr = student.weaknesses.map(w => `${w.trait}(${w.rating}점)`).join('; ');

      csvContent += `${escape(student.name)},${escape(student.selfDescription)},${escape(strengthsStr)},${escape(weaknessesStr)},${escape(student.evaluation)},${escape(student.feedback)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `행동특성_종합의견_결과표_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Clear App Roster
  const handleClearRoster = async () => {
    const confirmClear = window.confirm("등록된 전체 학생 명단을 삭제하고 초기화하시겠습니까? (이 작업은 되돌릴 수 없습니다!)");
    if (!confirmClear) return;

    if (classCode) {
      try {
        const qSnap = await getDocs(collection(db, 'classrooms', classCode, 'students'));
        const batch = writeBatch(db);
        qSnap.forEach(docSnap => {
          batch.delete(docSnap.ref);
        });
        await batch.commit();
        setSelectedStudentId(null);
      } catch (err) {
        console.error("Error clearing students from Firestore:", err);
      }
    } else {
      setStudents([]);
      setSelectedStudentId(null);
    }
  };

  // Restore Default Sample Data
  const handleRestoreSamples = async () => {
    if (classCode) {
      try {
        const batch = writeBatch(db);
        SAMPLE_STUDENTS.forEach(student => {
          const docRef = doc(db, 'classrooms', classCode, 'students', student.id);
          batch.set(docRef, student);
        });
        await batch.commit();
        setSelectedStudentId(SAMPLE_STUDENTS[0].id);
      } catch (err) {
        console.error("Error writing samples to Firestore:", err);
      }
    } else {
      setStudents(SAMPLE_STUDENTS);
      setSelectedStudentId(SAMPLE_STUDENTS[0].id);
    }
  };

  // Configuration Modal Save
  const handleSaveConfig = async (newConfig: AIServiceConfig, updatedClassroomPassword?: string) => {
    setApiConfig(newConfig);
    localStorage.setItem('ai_evaluator_config', JSON.stringify(newConfig));

    if (classCode) {
      try {
        const updateData: any = {
          apiConfig: newConfig
        };
        if (updatedClassroomPassword !== undefined) {
          if (!updatedClassroomPassword.trim()) {
            alert("⚠️ 보안을 위해 교사용 기록방 관리 비밀번호를 비워둘 수 없습니다. 정확한 관리 비밀번호를 기재해 주세요!");
            return;
          }
          updateData.password = updatedClassroomPassword.trim();
          setClassPassword(updatedClassroomPassword.trim());
          localStorage.setItem('teacher_class_password', updatedClassroomPassword.trim());
          localStorage.setItem(`teacher_pwd_for_${classCode}`, updatedClassroomPassword.trim());
        }
        await setDoc(doc(db, 'classrooms', classCode), updateData, { merge: true });
        console.log("Successfully persisted apiConfig & password to Firestore for classroom:", classCode);
      } catch (err) {
        console.error("Error persisting config to Firestore:", err);
      }
    }
  };

  return (
    <div className="bg-[#fcfbfc] text-slate-800 font-sans min-h-screen flex flex-col selection:bg-indigo-150 selection:text-indigo-900">
      
      {/* Dynamic App Modes gateway */}
      {(() => {
        if (appMode === 'selection') {
          return (
            <div className="bg-[#fcfbfc] text-slate-850 font-sans min-h-screen flex flex-col justify-center items-center p-6 bg-gradient-to-tr from-slate-50 to-indigo-50/30">
              <div className="max-w-3xl w-full space-y-8 py-10">
                <div className="text-center space-y-3">
                  <div className="inline-flex p-3.5 bg-indigo-50 text-indigo-700 rounded-2xl shadow-3xs">
                    <Sparkles size={32} className="text-indigo-600 animate-pulse" />
                  </div>
                  <h1 className="text-2xl md:text-3xl font-black text-slate-850 tracking-tight">
                    소통 중심 AI 생활기록부 & 성장 편지 빌더
                  </h1>
                  <p className="text-xs md:text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
                    본 시스템은 일방적인 평가 기록을 넘어, 학생의 자기조사와 실시간 동시 수집, 그리고 학생을 위로하는 성장 편지와 나이스(NEIS) 기재용 종합문안을 유기적으로 이어주는 스마트 교육 협업도구입니다.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6 pt-4">
                  {/* Student Mode Card */}
                  <div className="bg-white border border-slate-150 hover:border-rose-300 rounded-2xl p-6 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between group space-y-6">
                    <div className="space-y-3">
                      <div className="w-12 h-12 bg-rose-50 rounded-xl flex items-center justify-center text-rose-500 group-hover:scale-105 transition-transform">
                        <Heart size={22} className="fill-rose-100 text-rose-500" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-850 tracking-tight">
                        🧑‍🎓 학생 응답 및 편지 자가조사방
                      </h3>
                      <p className="text-xs text-slate-550 leading-relaxed">
                        학생이 직접 본인의 학업 태도, 장점 키워드와 스스로 느끼는 개선점을 간편하게 입력합니다. 응답 즉시 마음에 귀기울인 AI 담임선생님의 <b>성장 조언 편지</b>를 현장에서 직접 수령할 수 있습니다.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setAppMode('student');
                        localStorage.setItem('applet_app_mode', 'student');
                      }}
                      className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black text-xs py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all shadow-xs"
                    >
                      자가평가 제출 및 성장편지 열기 💌
                    </button>
                  </div>

                  {/* Teacher Mode Card */}
                  <div className="bg-white border border-slate-150 hover:border-indigo-300 rounded-2xl p-6 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between group space-y-6">
                    <div className="space-y-3">
                      <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500 group-hover:scale-105 transition-transform">
                        <Users size={22} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-850 tracking-tight">
                        👩‍🏫 담임교사 나이스(NEIS) 빌더실
                      </h3>
                      <p className="text-xs text-slate-550 leading-relaxed">
                        학생들의 무선 자기평가 제출 현황이 실시간으로 담임교사 화면에 동기화되어 채워집니다. 현황 확인 후 나이스 규정에 알맞은 <b>행동특성 종합의견 단락</b>을 일괄 작성하여 내보냅니다.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setAppMode('teacher');
                        localStorage.setItem('applet_app_mode', 'teacher');
                      }}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all shadow-xs"
                    >
                      담임 교사 대시보드 진입 💻
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-xl text-center text-[11px] text-slate-400 leading-normal">
                  💡 <b>실시간 연동 팁 (무선 배포):</b> 학생들에게 학급 스마트기기로 링크를 복사해 나누어주실 때, <br />
                  주소 뒤에 <code className="bg-slate-200/85 px-1.5 py-0.5 rounded text-indigo-750 font-mono text-[10px]">?mode=student</code>를 적어 전달하시면 첫 화면 선택창 없이 <b>즉시 학생조사 단독 화면</b>으로 실행됩니다!
                </div>
              </div>
            </div>
          );
        }

        if (appMode === 'student') {
          return (
            <div className="bg-[#fcfbfc] text-slate-800 font-sans min-h-screen flex flex-col justify-start">
              <StudentPortal 
                apiConfig={apiConfig} 
                onBackToHome={() => {
                  setAppMode('selection');
                  localStorage.setItem('applet_app_mode', 'selection');
                }} 
              />
            </div>
          );
        }

        return null;
      })()}

      {/* 2. Print Preview View Override */}
      {appMode === 'teacher' && (!classCode ? (
        <div className="bg-[#fcfbfc] text-slate-850 font-sans min-h-screen flex flex-col justify-center items-center p-6 bg-gradient-to-tr from-slate-50 to-indigo-50/30">
          <div className="max-w-2xl w-full mx-auto py-12 px-6 space-y-8 animate-fadeIn">
            {/* Header */}
            <div className="text-center space-y-3">
              <button
                onClick={() => {
                  setAppMode('selection');
                  localStorage.setItem('applet_app_mode', 'selection');
                }}
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs font-semibold bg-white border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                id="back_to_selection_btn"
              >
                <Home size={13} />
                처음 화면으로
              </button>
              <div className="inline-flex p-3 bg-indigo-50 text-indigo-700 rounded-2xl mx-auto shadow-3xs">
                <Users size={30} className="text-indigo-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">🏫 담임교사 학급 기록실 설정</h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                본 웹 애플리케이션은 다른 담임 선생님들과 기록 데이터를 완전히 분리하고, <br />
                학생들이 제출한 자기평가 정보를 실시간으로 안전하게 클라우드(Firestore)에 동기화하기 위해 <br />
                <b>전용 학급 기록방</b>을 개설하거나 기존 방에 입장해야 이용하실 수 있습니다.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 pt-4">
              {/* Card 1: Create New Room */}
              <div className="bg-white border border-slate-150 hover:border-indigo-300 rounded-2xl p-6 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <span className="text-[10px] font-extrabold text-indigo-500 tracking-wider block">NEW WORKSPACE</span>
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <span className="text-lg">✨</span>
                    새 학급 생기부 기록실 개설
                  </h3>
                  <p className="text-xs text-slate-550 leading-relaxed">
                    새로운 학년/학급을 위한 클라우드 저장 공간을 최초 분할 개설합니다. (예: 지혜초 5학년 2반)
                  </p>
                  <div className="space-y-4 pt-1">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold block">학급 이름 기재:</label>
                      <input
                        type="text"
                        placeholder="예: 서울새빛초 5-2"
                        value={tempClassName}
                        onChange={(e) => setTempClassName(e.target.value)}
                        className="w-full text-xs font-semibold p-3 border border-slate-200 bg-slate-50 rounded-xl focus:outline-none focus:border-indigo-400 focus:bg-white text-slate-800"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold block flex items-center gap-1">
                        <Lock size={10} className="text-slate-400" />
                        교사용 관리 비밀번호 지정 (추후 로그인 시 필요):
                      </label>
                      <input
                        type="password"
                        placeholder="예: 1234 (학생들의 무단 대시보드 접근 차단)"
                        value={tempCreatePassword}
                        onChange={(e) => setTempCreatePassword(e.target.value)}
                        className="w-full text-xs font-semibold p-3 border border-slate-200 bg-slate-50 rounded-xl focus:outline-none focus:border-indigo-400 focus:bg-white text-slate-800 font-mono tracking-widest"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleCreateClassroom}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-xs"
                >
                  지정 학급방 개설하고 대시보드 진입
                  <ArrowRight size={13} />
                </button>
              </div>

              {/* Card 2: Enter Existing Room */}
              <div className="bg-white border border-slate-150 hover:border-slate-300 rounded-2xl p-6 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <span className="text-[10px] font-extrabold text-slate-500 tracking-wider block">EXISTING WORKSPACE</span>
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <span className="text-lg">🔑</span>
                    기존 학급 기록실 참여 (입장)
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    이미 개설된 6자리 고유 학급 코드가 있다면 코드를 기재하여 즉시 참여할 수 있습니다.
                  </p>
                  <div className="space-y-4 pt-1">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold block">6자리 학급코드 기재:</label>
                      <input
                        type="text"
                        placeholder="예: H3F9A1"
                        maxLength={12}
                        value={tempClassCode}
                        onChange={(e) => setTempClassCode(e.target.value.toUpperCase().trim())}
                        className="w-full text-xs font-bold font-mono tracking-widest p-3 border border-slate-200 bg-slate-50 rounded-xl uppercase text-center focus:outline-none focus:border-slate-400 focus:bg-white text-slate-800 text-center"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold block flex items-center gap-1">
                        <Lock size={10} className="text-slate-400" />
                        교사용 관리 비밀번호 입력:
                      </label>
                      <input
                        type="password"
                        id="existing_room_password_input"
                        placeholder="설정된 비밀번호 입력 (공란인 예전 기록방은 바로 입장 가능)"
                        value={tempLoginPassword}
                        onChange={(e) => setTempLoginPassword(e.target.value)}
                        className="w-full text-xs font-semibold p-3 border border-slate-200 bg-slate-50 rounded-xl focus:outline-none focus:border-slate-400 focus:bg-white text-slate-800 font-mono tracking-widest"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleEnterClassroom}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-xs"
                >
                  기존 학급망 입장하기
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>

            {/* Local Recently Visited Rooms list history */}
            {recentClasses.length > 0 && (
              <div className="bg-white border border-slate-150 rounded-2xl p-5 space-y-3 shadow-3xs">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">최근 접속한 나의 학급 역사 목록 (원클릭 보안 연동 접속)</span>
                <div className="grid sm:grid-cols-2 gap-2">
                  {recentClasses.map((item) => (
                    <button
                      key={item.code}
                      onClick={() => handleEnterRecentClassroom(item.code, item.name)}
                      className="flex justify-between items-center text-left py-2.5 px-3 border border-slate-150 hover:border-indigo-200 rounded-xl text-xs font-semibold text-slate-700 bg-slate-50/50 hover:bg-indigo-50/25 cursor-pointer transition-colors group"
                    >
                      <span className="flex items-center gap-1">
                        <span className="text-slate-350 group-hover:text-amber-500 transition-colors">⭐</span>
                        {item.name}
                      </span>
                      <span className="font-mono text-[10px] bg-indigo-50 px-2 py-0.5 rounded text-indigo-650 font-black uppercase">{item.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : isPrintPreview ? (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
          <div className="flex justify-between items-center no-print border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">🖨️ 인쇄 / 서류 출력 모드</h2>
              <p className="text-xs text-slate-500 mt-0.5">[{className}] NEIS 기재용 생활기록부 종합의견 결과를 일괄 인쇄하거나 PDF로 저장합니다.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="bg-indigo-600 hover:bg-indigo-750 text-white font-semibold text-xs px-4 py-2 rounded-lg cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <Printer size={13} />
                페이지 인쇄 (Print)
              </button>
              <button
                onClick={() => setIsPrintPreview(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs px-4 py-2 rounded-lg cursor-pointer border border-slate-200"
              >
                편집 대시보드로 복귀
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {students.map((student, idx) => (
              <div key={student.id} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 print-page">
                <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                  <h3 className="font-bold text-slate-900 text-base">{idx + 1}. 이름: {student.name}</h3>
                  <span className="text-xs text-slate-400 font-mono">ID: {student.id}</span>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-xs text-slate-600">
                  <div className="bg-slate-50 p-2 rounded-md">
                    <span className="font-bold block mb-1">핵심 장점(강점)</span>
                    {student.strengths.map(s => `${s.trait}(${s.rating}점)`).join(', ') || '없음'}
                  </div>
                  <div className="bg-slate-50 p-2 rounded-md">
                    <span className="font-bold block mb-1">보완 영역(약점)</span>
                    {student.weaknesses.map(w => `${w.trait}(${w.rating}점)`).join(', ') || '없음'}
                  </div>
                  <div className="bg-slate-50 p-2 rounded-md">
                    <span className="font-bold block mb-1">자기평가 내용</span>
                    {student.selfDescription || '없음'}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-700 block">📝 학교생활기록부 행동특성 및 종합의견</span>
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-800 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                    {student.evaluation || <span className="text-slate-400 italic">생활기록부 의견서 문구가 생성되지 않았습니다.</span>}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-700 block text-indigo-700">💬 다정다감 상담 피드백 편지</span>
                  <div className="p-3 bg-indigo-50/20 border border-indigo-50 rounded-lg text-slate-700 text-xs leading-relaxed whitespace-pre-wrap font-sans italic">
                    {student.feedback || <span className="text-indigo-400 italic">상담 피드백 조언이 생성되지 않았습니다.</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Header Bar */}
          <header className="bg-white border-b border-slate-150/80 px-6 py-4 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-linear-to-tr from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center text-white shadow-xs">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-extrabold text-slate-800 tracking-tight">{className}</h1>
                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">코드: {classCode}</span>
                </div>
                <p className="text-xs text-slate-400 font-medium">실시간 동시 수집 중인 담임교사 생기부 빌더실 & 다정다감 상담 관리실</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-slate-850 hover:bg-slate-50 rounded-xl transition-all border border-slate-200 cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              >
                <Settings size={14} />
                AI 서비스 설정
              </button>
              <button
                onClick={() => {
                  if (window.confirm("현재 학급 기록실에서 퇴실하시겠습니까? (저장된 학생 기록 명단은 클라우드에 고스란히 온전히 보존되어 있으며, 학급코드로 언제든지 다시 로그인하실 수 있습니다!)")) {
                    setClassCode('');
                    setClassName('');
                    setClassPassword('');
                    localStorage.removeItem('teacher_class_code');
                    localStorage.removeItem('teacher_class_name');
                    localStorage.removeItem('teacher_class_password');
                  }
                }}
                className="p-2 text-rose-500 hover:bg-rose-50/50 rounded-xl transition-all border border-rose-200 cursor-pointer flex items-center gap-1.5 text-xs font-bold"
              >
                <LogOut size={14} />
                기록실 퇴실
              </button>
            </div>
          </header>

          {/* Core App Workspace layout */}
          <main className="flex-1 max-w-[1700px] w-full mx-auto p-6 flex flex-col space-y-5 overflow-hidden">
            
            {/* Live Student Intake Broadcast notice bar */}
            <div className="bg-gradient-to-r from-rose-50/60 to-indigo-50/60 border border-indigo-150/70 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-center gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white rounded-xl shadow-3xs text-rose-500 shrink-0">
                  <Heart size={16} className="fill-rose-100 text-rose-500 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-800 tracking-tight">우리 학급 맞춤 실시간 연동 기능 가동 중!</h4>
                  <p className="text-[10px] text-slate-500 leading-normal mt-0.5">
                     학생들에게 아래 <b>우리 반 전용 링크</b>를 공유해 응답하도록 하세요! 학생들이 스마트기기로 입력한 장점/역량이 대시보드에 실시간으로 기록됩니다.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="bg-white border border-slate-200/80 px-3 py-1.5 rounded-xl text-[10px] font-mono font-bold text-slate-600 flex-1 md:flex-initial select-all">
                  {window.location.origin}/?mode=student&class={classCode}
                </div>
                <button
                  onClick={handleManualSync}
                  disabled={isSyncing}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-3xs cursor-pointer flex items-center gap-1.5 transition-all text-center shrink-0 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={isSyncing ? "animate-spin" : ""} />
                  {isSyncing ? "동기화 중..." : "서버 동기화 새로고침"}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/?mode=student&class=${classCode}`);
                    alert("우리 반 전용 학생 자가조사 및 성장 편지제출 링크가 복사되었습니다! 알리미, 구글 클래스룸 또는 스마트칠판 등에 배포해 주세요.");
                  }}
                  className="bg-indigo-600 hover:bg-indigo-750 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-3xs cursor-pointer flex items-center gap-1 transition-all text-center shrink-0"
                >
                  <Copy size={11} />
                  배포 링크 복사
                </button>
                <button
                  onClick={() => {
                    setAppMode('selection');
                    localStorage.setItem('applet_app_mode', 'selection');
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-650 border border-slate-200 font-bold text-xs px-3 py-2 rounded-xl cursor-pointer transition-all hover:text-slate-900 shrink-0 text-center"
                >
                  처음 화면으로
                </button>
              </div>
            </div>

            {/* Dynamic Batch Generation Callout Banner */}
            {students.length > 0 && students.some(s => !s.evaluation) && (
              <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-3xs animate-fadeIn">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-white rounded-xl shadow-3xs text-amber-500 shrink-0">
                    <Sparkles size={16} className="text-amber-500 animate-bounce" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-amber-900 tracking-tight">아직 생활기록부 의견서가 생성되지 않은 학생이 존재합니다!</h4>
                    <p className="text-[10px] text-amber-700 leading-normal mt-0.5">
                      학생 개별로 한 명씩 생성 버튼을 누를 필요 없이, 하단의 <span className="font-bold">"✨ 전체 AI 일괄 자동생성"</span> 버튼을 클릭하시면 학급 전체 학생들의 의견서와 성장 상담편지가 순차적으로 한 번에 자동 완성됩니다.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleBatchGenerateAll}
                  disabled={isBatchGenerating}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all flex items-center gap-1 shrink-0 disabled:opacity-40"
                >
                  <Play size={10} fill="white" />
                  지금 전체 일괄 생성하기
                </button>
              </div>
            )}

            {/* Batch / Roster Summary Actions bar */}
            <section className="bg-white border border-slate-100 rounded-2xl p-4 shadow-2xs flex flex-wrap justify-between items-center gap-4">
              
              <div className="flex items-center gap-4">
                {/* Stats */}
                <div className="flex items-center gap-6">
                  <div className="text-xs">
                    <span className="text-slate-400 block font-medium">총 배치 학생수</span>
                    <span className="text-lg font-extrabold text-slate-800 block-mt-0.5">{students.length}명</span>
                  </div>
                  <div className="text-xs border-l border-slate-150 pl-6">
                    <span className="text-slate-400 block font-medium">종합의견 생성됨</span>
                    <span className="text-lg font-extrabold text-indigo-700 block-mt-0.5">
                      {students.filter(s => s.evaluation).length}명
                    </span>
                  </div>
                </div>

                {/* Batch Progress Bar Indicator */}
                {isBatchGenerating && (
                  <div className="flex items-center gap-3 bg-indigo-50/50 border border-indigo-100 px-4 py-2 rounded-xl">
                    <RefreshCw size={14} className="animate-spin text-indigo-600" />
                    <div className="text-xs">
                      <span className="font-bold text-indigo-800">일괄 자동생성 실행중...</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="w-28 bg-indigo-100 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-indigo-600 h-full transition-all duration-300" 
                            style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-indigo-700 font-bold">{batchProgress.current}/{batchProgress.total}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Operations Control buttons */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <button
                  onClick={() => setIsExcelImportOpen(true)}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold text-xs px-3 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all"
                >
                  <Upload size={13} />
                  엑셀/구글시트 직접 붙여넣기
                </button>

                <button
                  onClick={handleBatchGenerateAll}
                  disabled={isBatchGenerating || students.length === 0}
                  className={`bg-linear-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-extrabold text-xs px-4.5 py-2.5 rounded-xl shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-95 cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none disabled:transform-none disabled:shadow-none`}
                >
                  <Play size={12} fill="white" />
                  ✨ 전체 AI 일괄 자동생성
                </button>

                <button
                  onClick={handleExportCSV}
                  disabled={students.length === 0}
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all"
                >
                  <Download size={13} />
                  결과 Excel CSV 다운로드
                </button>

                <button
                  onClick={() => setIsPrintPreview(true)}
                  disabled={students.length === 0}
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all"
                >
                  <Printer size={13} />
                  인쇄 및 전체 출력
                </button>

                <div className="h-6 w-px bg-slate-200 mx-1" />

                <button
                  onClick={handleRestoreSamples}
                  className="text-slate-400 hover:text-slate-600 text-xs font-semibold px-2"
                  title="샘플 양식 불러오기"
                >
                  예시 복구
                </button>
                <button
                  onClick={handleClearRoster}
                  className="text-red-400 hover:text-red-650 text-xs font-semibold px-2"
                  title="전체 명단 비우기"
                >
                  명단 비우기
                </button>
              </div>

            </section>

            {/* Core Roster Grid & Workspace Panels */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0 overflow-hidden">
              
              {/* Left Column: Student List Selection Panel (lg:col-span-4) */}
              <section className="lg:col-span-4 bg-white border border-slate-100 rounded-2xl shadow-2xs flex flex-col overflow-hidden min-h-0">
                <div className="p-4 border-b border-slate-100 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-800">📋 가동 학급 학생부 ({students.length}명)</span>
                    <button
                      type="button"
                      onClick={handleManualSync}
                      disabled={isSyncing}
                      className="text-[11px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                      title="클라우드 동기화 새로고침"
                    >
                      <RefreshCw size={10} className={isSyncing ? "animate-spin" : ""} />
                      {isSyncing ? "연동 중" : "실시간 수집"}
                    </button>
                  </div>
                  
                  {/* Enter individual student name form */}
                  <form onSubmit={handleAddStudent} className="flex gap-2">
                    <input
                      type="text"
                      value={newStudentName}
                      onChange={(e) => setNewStudentName(e.target.value)}
                      placeholder="신입 학생명 입력..."
                      maxLength={10}
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all text-slate-800"
                    />
                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2 rounded-xl cursor-pointer flex items-center gap-1 shadow-xs transition-all shrink-0"
                    >
                      <Plus size={14} />
                      추가
                    </button>
                  </form>
                </div>

                {/* Scrollable list of students */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {students.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <div className="text-slate-300 w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center mx-auto border border-dashed border-slate-200">
                        <Database size={18} />
                      </div>
                      <p className="text-xs font-bold text-slate-500">등록된 학생이 없습니다</p>
                      <p className="text-[11px] text-slate-450 leading-relaxed px-4">
                        상단의 "엑셀 직접 붙여넣기"를 이용하여 구글시트 행을 가져오거나, 학생 추가로 새 데이터를 기입해 주세요. 만약 예시를 보시려면 "예시 복구"를 누르세요.
                      </p>
                    </div>
                  ) : (
                    students.map(s => {
                      const isSelected = s.id === selectedStudentId;
                      const hasCompletedReports = s.evaluation && s.feedback;
                      return (
                        <div
                          key={s.id}
                          onClick={() => setSelectedStudentId(s.id)}
                          className={`p-4 flex justify-between items-center cursor-pointer transition-all ${
                            isSelected 
                            ? 'bg-indigo-50/50 border-l-3 border-indigo-600 bg-radial from-white to-indigo-50/20' 
                            : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="space-y-1 my-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-xs text-slate-800">{s.name}</span>
                              {s.password && (
                                <span className="text-[9px] text-amber-700 bg-amber-50 px-1 py-0.2 rounded font-mono font-bold flex items-center gap-0.5" title="설정한 4자리 비밀번호 (학생 조회 자물쇠 키)">
                                  🔐 {s.password}
                                </span>
                              )}
                              {s.status === 'generating' && (
                                <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-sm font-semibold animate-pulse">분석중</span>
                              )}
                              {s.status === 'completed' && (
                                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-sm font-bold">생성완료</span>
                              )}
                              {s.status === 'error' && (
                                <span className="text-[10px] text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-sm font-semibold" title={s.errorMsg}>오류발생</span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 font-medium truncate max-w-[200px]" title={s.selfDescription}>
                              {s.selfDescription || '자기평가가 비어있습니다.'}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded font-bold">
                              {s.strengths.length + s.weaknesses.length}개 지표
                            </span>
                            <button
                              onClick={(e) => handleDeleteStudent(s.id, e)}
                              className="text-slate-350 hover:text-red-650 opacity-0 hover:opacity-100 group-hover:opacity-100 select-student-delete p-1 rounded transition-all transition-opacity cursor-pointer"
                              title="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {/* Middle & Right Column: Interactive Workspace & AI Output (lg:col-span-8) */}
              <section className="lg:col-span-8 flex flex-col md:grid md:grid-cols-12 gap-5 min-h-0 overflow-hidden">
                
                {/* Active Student Detail Editing Panel (col-span-6) */}
                <div className="md:col-span-6 bg-white border border-slate-100 rounded-2xl shadow-2xs p-5 flex flex-col space-y-4 overflow-y-auto h-full">
                  {activeStudent ? (
                    <>
                      {/* Name and general self-description */}
                      <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-800">📝 학생 프로필 상세 기재</span>
                        <span className="text-[10px] text-slate-400 font-mono">ID: {activeStudent.id}</span>
                      </div>

                      <div className="space-y-3 flex-1">
                        {/* Name & Password Side-by-side */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-slate-700 block">학생 성명</label>
                            <input
                              type="text"
                              value={activeStudent.name || ''}
                              onChange={(e) => handleUpdateStudentTraits(activeStudent.id, { name: e.target.value })}
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs font-semibold rounded-xl focus:outline-hidden focus:border-indigo-500 focus:bg-white text-slate-800"
                              placeholder="성명 명칭"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-slate-700 block flex items-center gap-1">
                              <span>🔐 자기 조회 비밀번호</span>
                            </label>
                            <input
                              type="text"
                              maxLength={4}
                              value={activeStudent.password || ''}
                              onChange={(e) => handleUpdateStudentTraits(activeStudent.id, { password: e.target.value.replace(/[^0-9]/g, '') })}
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs font-mono font-bold rounded-xl focus:outline-hidden focus:border-indigo-500 focus:bg-white text-amber-800 tracking-wider"
                              placeholder="임의 숫자 4자리"
                            />
                          </div>
                        </div>

                        {/* Self Description Box */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-slate-700 block">학생 자기평가 내용 (학업태도, 특이사항)</label>
                          <textarea
                            value={activeStudent.selfDescription || ''}
                            onChange={(e) => handleUpdateStudentTraits(activeStudent.id, { selfDescription: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:outline-hidden focus:border-indigo-500 focus:bg-white resize-none text-slate-700 leading-normal"
                            rows={3}
                            placeholder="학생이 본인의 학업과 수업에서 느낀 강약점, 특기를 서술해 둔 문건을 여기에 복사하여 넣으세요..."
                          />
                        </div>

                        {/* Interactive Strengths Configuration Panel */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <div className="flex justify-between items-center">
                            <label className="text-[11px] font-bold text-emerald-800 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded">
                              🟢 핵심 강점 (Strengths)
                            </label>
                            <span className="text-[10px] text-slate-400 font-medium">슬라이더로 등급 점수(1-10) 조율</span>
                          </div>

                          <div className="space-y-2">
                            {/* Active Strengths Traits List */}
                            {activeStudent.strengths.length === 0 ? (
                              <p className="text-[11px] text-slate-400 italic">아래 추천 인물 지표에서 강점 설정을 채우세요.</p>
                            ) : (
                              activeStudent.strengths.map(item => (
                                <div key={item.trait} className="flex items-center justify-between text-xs bg-emerald-50/35 border border-emerald-100 p-2 rounded-lg">
                                  <div className="flex items-center gap-1.5 w-1/3">
                                    <span className="font-bold text-emerald-900 truncate">{item.trait}</span>
                                    <span className="font-mono text-[10px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-extrabold">{item.rating}점</span>
                                  </div>
                                  
                                  {/* Slider score */}
                                  <input
                                    type="range"
                                    min="1"
                                    max="10"
                                    value={item.rating}
                                    onChange={(e) => handleUpdateTraitRating(activeStudent.id, item.trait, parseInt(e.target.value), 'strengths')}
                                    className="w-1/3 h-1 bg-emerald-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                                  />

                                  <button
                                    onClick={() => handleRemoveTraitFromStudent(activeStudent.id, item.trait, 'strengths')}
                                    className="text-slate-400 hover:text-red-650 cursor-pointer text-[10px] px-1 font-semibold"
                                  >
                                    제거
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Interactive Weaknesses Configuration Panel */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <label className="text-[11px] font-bold text-rose-800 flex items-center gap-1 bg-rose-50 px-2 py-0.5 rounded w-fit">
                            🔴 성장 및 보완 영역 (Weaknesses)
                          </label>

                          <div className="space-y-2">
                            {/* Active Weaknesses Traits List */}
                            {activeStudent.weaknesses.length === 0 ? (
                              <p className="text-[11px] text-slate-400 italic">아래 추천 지표에서 약점 영역을 설정하세요.</p>
                            ) : (
                              activeStudent.weaknesses.map(item => (
                                <div key={item.trait} className="flex items-center justify-between text-xs bg-rose-50/20 border border-rose-100 p-2 rounded-lg">
                                  <div className="flex items-center gap-1.5 w-1/3">
                                    <span className="font-bold text-rose-900 truncate">{item.trait}</span>
                                    <span className="font-mono text-[10px] bg-rose-100 text-rose-800 px-1 py-0.2 rounded font-extrabold">{item.rating}점</span>
                                  </div>
                                  
                                  {/* Slider score */}
                                  <input
                                    type="range"
                                    min="1"
                                    max="10"
                                    value={item.rating}
                                    onChange={(e) => handleUpdateTraitRating(activeStudent.id, item.trait, parseInt(e.target.value), 'weaknesses')}
                                    className="w-1/3 h-1 bg-rose-100 rounded-lg appearance-none cursor-pointer accent-rose-600"
                                  />

                                  <button
                                    onClick={() => handleRemoveTraitFromStudent(activeStudent.id, item.trait, 'weaknesses')}
                                    className="text-slate-400 hover:text-red-650 cursor-pointer text-[10px] px-1 font-semibold"
                                  >
                                    제거
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Fast Presets Clicks Bank */}
                        <div className="border-t border-slate-100 pt-3 space-y-2">
                          <span className="text-[11px] font-bold text-slate-600 block">💡 추천 학급 지표 즉시 추가 bank</span>
                          
                          <div className="max-h-[170px] overflow-y-auto space-y-2.5 pr-1 py-0.5">
                            {['생활', '인성', '학습'].map(cat => (
                              <div key={cat} className="space-y-1">
                                <span className="text-[9px] font-extrabold text-indigo-650 bg-indigo-50/60 px-1.5 py-0.2 rounded font-serif block w-fit">{cat}</span>
                                <div className="flex flex-wrap gap-1">
                                  {PRESET_TRAITS.filter(p => p.category === cat).map(p => (
                                    <div key={p.name} className="flex items-center bg-slate-50 border border-slate-150 rounded-lg p-1 hover:border-indigo-300 transition-colors">
                                      <span className="text-[10px] text-slate-700 font-semibold px-1" title={p.description}>{p.name.split(' (')[0]}</span>
                                      
                                      <div className="flex divide-x divide-slate-200 ml-1.5 border-l border-slate-200 pl-1 font-mono text-[9px] font-extrabold">
                                        <button
                                          onClick={() => handleAddTraitToStudent(activeStudent.id, p.name.split(' (')[0], 'strengths')}
                                          className="text-emerald-700 px-1 hover:bg-emerald-50 rounded"
                                        >
                                          강점+
                                        </button>
                                        <button
                                          onClick={() => handleAddTraitToStudent(activeStudent.id, p.name.split(' (')[0], 'weaknesses')}
                                          className="text-rose-700 px-1 hover:bg-rose-50 rounded"
                                        >
                                          약점+
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                      <HelpCircle size={32} strokeWidth={1.5} className="mb-2 text-slate-300" />
                      <p className="text-xs font-bold">선택된 학생이 없습니다.</p>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-xs leading-normal">좌측 학생 명단에서 상세 기재할 학생을 선택해 주세요.</p>
                    </div>
                  )}
                </div>

                {/* Right Column: AI Production Output Panel (col-span-6) */}
                <div className="md:col-span-6 h-full min-h-[300px]">
                  {activeStudent ? (
                    <AIPresentation
                      student={activeStudent}
                      onGenerate={handleGenerateSingle}
                      onUpdateContent={handleUpdateContent}
                      isGenerating={activeStudent.status === 'generating'}
                      onToggleFeedbackSent={handleToggleFeedbackSent}
                    />
                  ) : (
                    <div className="bg-white border border-slate-100 rounded-2xl p-6 h-full flex flex-col justify-center items-center text-center text-slate-400">
                      <Sparkles size={32} className="text-slate-300 mb-2" />
                      <h4 className="font-bold text-xs text-slate-700">생성 작업 영역 비활성</h4>
                      <p className="text-[10px] text-slate-450 mt-1 max-w-xs leading-normal">생활기록부 의견 생성을 개별 테스트하려면 왼쪽 학생 명단에서 한 명을 클릭하세요.</p>
                    </div>
                  )}
                </div>

              </section>

            </div>
          </main>
        </>
      ))}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={apiConfig}
        onSave={handleSaveConfig}
        classCode={classCode}
        classroomPassword={classPassword}
      />

      {/* Spreadsheet Paste Import Modal */}
      <ExcelPasteModal
        isOpen={isExcelImportOpen}
        onClose={() => setIsExcelImportOpen(false)}
        onImport={handleImportStudents}
      />

    </div>
  );
}
