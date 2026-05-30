import { useState, useEffect } from 'react';
import { AIServiceConfig } from '../types';
import { X, Save, ShieldAlert, BadgeCheck, Eye, EyeOff } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIServiceConfig;
  onSave: (newConfig: AIServiceConfig) => void;
}

export default function SettingsModal({ isOpen, onClose, config, onSave }: SettingsModalProps) {
  const [service, setService] = useState<AIServiceConfig['service']>('built-in');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setService(config.service);
      setApiKey(config.apiKey || '');
      setModel(config.model || '');
      setSaveSuccess(false);
    }
  }, [isOpen, config]);

  const handleSave = () => {
    onSave({
      service,
      apiKey: service === 'built-in' ? undefined : apiKey,
      model: service === 'built-in' ? undefined : model
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-pulse" />
            <h3 className="text-base font-bold text-slate-800">✨ AI 서비스 설정</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Service Selector */}
          <div className="space-y-1.55">
            <label className="text-xs font-bold text-slate-700 block">사용할 AI 서비스 선택</label>
            <select
              value={service}
              onChange={(e) => {
                const selected = e.target.value as AIServiceConfig['service'];
                setService(selected);
                if (selected === 'custom-openai') {
                  setModel('gpt-4o-mini');
                } else if (selected === 'custom-gemini') {
                  setModel('gemini-3.5-flash');
                } else {
                  setModel('');
                  setApiKey('');
                }
              }}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-100 focus:bg-white focus:border-indigo-500 transition-all font-medium text-slate-800 cursor-pointer"
            >
              <option value="built-in">🍀 기본 탑재 AI (Gemini 3.5 Flash) - 즉시 한도 적용</option>
              <option value="custom-gemini">💎 개인 Gemini (사용자 API 키 사용)</option>
              <option value="custom-openai">⚡ 개인 OpenAI GPT-4o-mini (사용자 API 키 사용)</option>
            </select>
          </div>

          {service === 'built-in' ? (
            <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2">
              <p className="text-xs text-indigo-900 leading-relaxed font-medium flex items-center gap-1">
                <BadgeCheck size={14} className="text-indigo-600" />
                서버 기본 탑재 AI가 즉시 활성화되어 있습니다
              </p>
              <p className="text-[11px] text-indigo-700/80 leading-relaxed">
                본인의 API 키를 소지하지 않아도, Google AI Studio 서버 가동 키를 이용하여 생활기록부 평가서 및 상담 피드백을 자유롭게 생성할 수 있습니다. (추가 설정 불요)
              </p>
            </div>
          ) : (
            <>
              {/* API Key */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex justify-between items-center">
                  <span>API 인증키 입력</span>
                  <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded">사용자 소유 키</span>
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={service === 'custom-openai' ? "sk-..." : "AI..."}
                    className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-100 focus:bg-white focus:border-indigo-500 transition-all text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Custom Model */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">버전 모델명</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={service === 'custom-openai' ? "gpt-4o-mini" : "gemini-3.5-flash"}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-100 focus:bg-white focus:border-indigo-500 transition-all text-slate-800"
                />
                <p className="text-[10px] text-slate-400 leading-tight pl-1">
                  {service === 'custom-openai' 
                    ? "권장 모델: gpt-4o-mini, gpt-4o" 
                    : "권장 모델: gemini-3.5-flash"}
                </p>
              </div>

              {/* Warning Alert */}
              <div className="bg-amber-50/50 border border-amber-100 p-3.5 rounded-xl text-xs text-amber-800 leading-relaxed font-light flex gap-2">
                <ShieldAlert size={22} className="text-amber-600 shrink-0 mt-0.5" />
                <span>개인 인증 키 정보는 브라우저 내부 로컬스토리지에만 보관하고 작동되어 외부로 안전히 차단 및 암호 보호를 제공합니다.</span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all rounded-xl cursor-pointer"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saveSuccess}
            className={`px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-xs flex items-center gap-1.5 transition-all ${
              saveSuccess 
              ? 'bg-green-600 shadow-teal-50 cursor-default' 
              : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md cursor-pointer'
            }`}
          >
            {saveSuccess ? (
              <>
                <BadgeCheck size={16} />
                저장 완료!
              </>
            ) : (
              <>
                <Save size={16} />
                설정 저장
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
