import { useState, useEffect } from 'react';
import { Student } from '../types';
import { Copy, Check, FileText, Heart, RefreshCw, PenTool, CheckSquare } from 'lucide-react';

interface AIPresentationProps {
  student: Student;
  onGenerate: (type: 'evaluation' | 'feedback') => void;
  onUpdateContent: (studentId: string, evaluation: string, feedback: string) => void;
  isGenerating: boolean;
}

export default function AIPresentation({ student, onGenerate, onUpdateContent, isGenerating }: AIPresentationProps) {
  const [activeTab, setActiveTab] = useState<'evaluation' | 'feedback'>('evaluation');
  const [copied, setCopied] = useState(false);
  
  // Local edit states
  const [editedEvaluation, setEditedEvaluation] = useState('');
  const [editedFeedback, setEditedFeedback] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setEditedEvaluation(student.evaluation || '');
    setEditedFeedback(student.feedback || '');
    setIsEditing(false);
  }, [student]);

  const handleCopy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleSaveEdit = () => {
    onUpdateContent(student.id, editedEvaluation, editedFeedback);
    setIsEditing(false);
  };

  const currentText = activeTab === 'evaluation' ? editedEvaluation : editedFeedback;
  const wordCount = currentText.length;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-xs flex flex-col h-full overflow-hidden">
      
      {/* Target Student Header */}
      <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-radial from-white to-slate-50/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center font-bold text-lg border border-indigo-100">
            {student.name.charAt(0)}
          </div>
          <div>
            <h4 className="font-bold text-slate-800 text-base">{student.name} 학생 평가</h4>
            <p className="text-xs text-slate-400 font-medium">강점 {student.strengths.length}개 · 약점 {student.weaknesses.length}개 설정됨</p>
          </div>
        </div>

        {/* Action Tabs */}
        <div className="flex bg-slate-200/50 p-1 rounded-xl border border-slate-200/30">
          <button
            onClick={() => setActiveTab('evaluation')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeTab === 'evaluation'
                ? 'bg-white text-slate-800 shadow-xs ring-1 ring-slate-100'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText size={13} />
            생기부 행동발달
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeTab === 'feedback'
                ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-105'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Heart size={13} />
            성장 상담편지
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="p-6 flex-1 flex flex-col space-y-4">
        
        {/* Status Indicators */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">
              {activeTab === 'evaluation' ? '생활기록부 종합의견 문구' : '다정다감 일대일 소통편지'}
            </span>
            {currentText && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                activeTab === 'evaluation' 
                ? 'bg-slate-50 border border-slate-200 text-slate-600'
                : 'bg-indigo-50 border border-indigo-100 text-indigo-600'
              }`}>
                {wordCount}자 {activeTab === 'evaluation' && wordCount > 400 && '⚠️ 생기부 초과 우려'}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {currentText && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1 bg-slate-50 hover:bg-slate-100/80 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors cursor-pointer font-medium"
              >
                <PenTool size={12} />
                직접 수정
              </button>
            )}
            {isEditing && (
              <button
                onClick={handleSaveEdit}
                className="text-xs text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer flex items-center gap-1 px-3 py-1 rounded-lg shadow-xs transition-colors font-medium"
              >
                <CheckSquare size={12} />
                수정 완료
              </button>
            )}
          </div>
        </div>

        {/* Text Area Work Area */}
        <div className="flex-1 flex flex-col min-h-[220px]">
          {isEditing ? (
            <textarea
              value={activeTab === 'evaluation' ? editedEvaluation : editedFeedback}
              onChange={(e) => {
                if (activeTab === 'evaluation') {
                  setEditedEvaluation(e.target.value);
                } else {
                  setEditedFeedback(e.target.value);
                }
              }}
              className="w-full flex-1 p-4 bg-slate-50/50 border border-indigo-200 focus:border-indigo-500 focus:bg-white rounded-xl text-slate-700 text-sm leading-relaxed font-sans focus:outline-hidden transition-all resize-none shadow-inner"
              placeholder="내용을 직접 수정해 보세요..."
            />
          ) : (
            <div className={`w-full flex-1 p-4 rounded-xl border flex flex-col justify-between ${
              currentText 
              ? 'bg-slate-50/40 border-slate-100' 
              : 'bg-slate-50/20 border-dashed border-slate-200 justify-center items-center text-center p-8'
            }`}>
              {currentText ? (
                <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {currentText}
                </p>
              ) : (
                <div className="space-y-3 p-4 max-w-sm">
                  <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mx-auto">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-700 text-sm">작성된 내용이 아직 없습니다</h5>
                    <p className="text-xs text-slate-400 mt-1 leading-normal">
                      왼쪽의 정보(강점/약점/자기평가)를 채운 뒤 아래 생성 버튼을 클릭하거나, 상단 일괄 일괄생성으로 자동으로 완성하세요.
                    </p>
                  </div>
                </div>
              )}

              {/* Character Limit Alerts */}
              {currentText && activeTab === 'evaluation' && (
                <div className="mt-3 text-[10px] text-slate-400 font-mono text-right">
                  * NEIS 생기부 등록 규정 권장: 300~400자 사이 (현재: {wordCount}자)
                </div>
              )}
            </div>
          )}
        </div>

        {/* Generate / Action Buttons Row */}
        <div className="flex gap-3">
          <button
            onClick={() => onGenerate(activeTab)}
            disabled={isGenerating}
            className={`flex-1 py-3 text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer ${
              isGenerating
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : activeTab === 'evaluation'
                ? 'bg-slate-800 text-white hover:bg-slate-900 hover:shadow-md'
                : 'bg-indigo-650 text-white hover:bg-indigo-700 hover:shadow-md'
            }`}
          >
            <RefreshCw size={15} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating
              ? 'AI 데이터 분석중...'
              : activeTab === 'evaluation'
              ? 'AI 생기부 종합의견 생성'
              : 'AI 다정다감 상담조언 생성'}
          </button>

          {currentText && (
            <button
              onClick={() => handleCopy(currentText)}
              className={`px-4 py-3 text-sm font-semibold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                copied
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-250'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? '복색 완료' : '복사'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
