import React, { useState } from 'react';
import { Student } from '../types';
import { X, Check, AlertCircle } from 'lucide-react';

interface ExcelPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (students: Student[]) => void;
}

export default function ExcelPasteModal({ isOpen, onClose, onImport }: ExcelPasteModalProps) {
  const [inputText, setInputText] = useState('');
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInputText(text);
    
    if (!text.trim()) {
      setParsedRows([]);
      setPreviewError(null);
      return;
    }

    try {
      // Split into lines
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      const tempRows: any[] = [];

      lines.forEach((line, index) => {
        // Detect Excel tabs first, fallback to commas, or semicolons
        let cols: string[] = [];
        if (line.includes('\t')) {
          cols = line.split('\t');
        } else if (line.includes(',')) {
          cols = line.split(',');
        } else {
          cols = [line];
        }

        cols = cols.map(c => c.trim().replace(/^["']|["']$/g, '')); // Strip outer quotes

        if (cols.length >= 1) {
          const name = cols[0] || `미명 학생 ${index + 1}`;
          
          // Try to extract strengths
          let strengthsStr = cols[1] || '';
          let weaknessesStr = cols[2] || '';
          let selfDesc = cols[3] || '';

          // Let's parser strength rating like "성실성(9점)" or just "성실성(9)" or "성실성"
          const parseTraits = (rawStr: string): { trait: string; rating: number }[] => {
            if (!rawStr) return [];
            return rawStr.split(/[,&]/).map(t => {
              const cleaned = t.trim();
              const scoreMatch = cleaned.match(/(.+?)\((\d+)(?:점)?\)/);
              if (scoreMatch) {
                return { trait: scoreMatch[1].trim(), rating: Math.min(10, Math.max(1, parseInt(scoreMatch[2]))) };
              }
              return { trait: cleaned, rating: 8 }; // default standard rating
            }).filter(item => item.trait.length > 0);
          };

          tempRows.push({
            id: `imported-${Date.now()}-${index}`,
            name,
            strengths: parseTraits(strengthsStr),
            weaknesses: parseTraits(weaknessesStr),
            selfDescription: selfDesc,
            evaluation: '',
            feedback: '',
            status: 'idle'
          });
        }
      });

      if (tempRows.length === 0) {
        setPreviewError('데이터가 올바른 형식으로 구성되어 있는지 확인하세요.');
      } else {
        setPreviewError(null);
        setParsedRows(tempRows);
      }
    } catch (err: any) {
      setPreviewError('정상적으로 분류하기 어렵습니다: ' + err.message);
    }
  };

  const handleImportClick = () => {
    if (parsedRows.length > 0) {
      onImport(parsedRows);
      setInputText('');
      setParsedRows([]);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">엑셀/구글 시트 데이터 붙여넣기</h3>
            <p className="text-xs text-slate-500 mt-1">엑셀에서 행을 복사(Ctrl+C)하여 아래 영역에 붙여넣으면 한 번에 등록됩니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Guide box */}
          <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 text-xs text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1">
              <AlertCircle size={14} className="text-amber-600" /> 
              [권장 데이터 구조] 열 배치 기준
            </p>
            <p className="text-amber-800">
              구글 시트/엑셀에서 순서대로 <span className="font-medium bg-amber-100/50 px-1 rounded">1열: 이름 | 2열: 강점 | 3열: 약점 | 4열: 자기평가</span>에 맞춰 복사해 주세요.
            </p>
            <p className="text-amber-700 italic mt-1 font-mono">
              (예시): 홍길동 <span className="text-slate-400">&lt;Tab&gt;</span> 성실성(9점), 배려심(8점) <span className="text-slate-400">&lt;Tab&gt;</span> 집중력(5점) <span className="text-slate-400">&lt;Tab&gt;</span> 조용히 복습을 잘함
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700">텍스트 붙여넣기 영역</label>
            <textarea
              id="excel-paste-text"
              value={inputText}
              onChange={handleTextChange}
              placeholder="여기에 복사한 데이터를 붙여넣으세요..."
              rows={6}
              className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-100 focus:bg-white focus:border-indigo-500 font-mono transition-all resize-none placeholder-slate-400"
            />
          </div>

          {previewError && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs flex gap-2 items-center leading-relaxed">
              <AlertCircle size={16} />
              <span>{previewError}</span>
            </div>
          )}

          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-800">파싱 미리보기 (총 {parsedRows.length}명)</span>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">형식 검증 완료</span>
              </div>
              <div className="border border-slate-100 rounded-xl overflow-hidden text-xs max-h-[220px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 font-medium text-slate-600">
                      <th className="px-4 py-2 border-r border-slate-100 w-1/5">이름</th>
                      <th className="px-4 py-2 border-r border-slate-100 w-1/4">강점 (평가점수)</th>
                      <th className="px-4 py-2 border-r border-slate-100 w-1/4">약점 (평가점수)</th>
                      <th className="px-4 py-2">자기평가 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors text-slate-700">
                        <td className="px-4 py-2 font-semibold border-r border-slate-100 text-slate-900 bg-slate-50/20">{row.name}</td>
                        <td className="px-4 py-2 border-r border-slate-100">
                          {row.strengths.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.strengths.map((s: any, i: number) => (
                                <span key={i} className="bg-green-50 text-green-700 text-[10px] px-1.5 py-0.5 rounded">
                                  {s.trait}({s.rating}점)
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-light italic">없음</span>
                          )}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-100">
                          {row.weaknesses.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.weaknesses.map((w: any, i: number) => (
                                <span key={i} className="bg-red-50 text-red-700 text-[10px] px-1.5 py-0.5 rounded">
                                  {w.trait}({w.rating}점)
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-light italic">없음</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-500 truncate max-w-[200px]" title={row.selfDescription}>
                          {row.selfDescription || <span className="text-slate-300 font-light italic">비어있음</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all rounded-xl"
          >
            취소
          </button>
          <button
            onClick={handleImportClick}
            disabled={parsedRows.length === 0}
            className={`px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-xs flex items-center gap-1.5 transition-all ${
              parsedRows.length > 0
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:shadow-md cursor-pointer'
                : 'bg-slate-300 cursor-not-allowed'
            }`}
          >
            <Check size={16} />
            학생 {parsedRows.length}명 가져오기
          </button>
        </div>

      </div>
    </div>
  );
}
