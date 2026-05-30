import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// In-Memory Shared Student DB for real-time synchronization
interface TraitItem {
  trait: string;
  rating: number;
}

interface Student {
  id: string;
  name: string;
  selfDescription: string;
  strengths: TraitItem[];
  weaknesses: TraitItem[];
  evaluation: string;
  feedback: string;
  status: 'idle' | 'generating' | 'completed' | 'error';
  errorMsg?: string;
  updatedAt?: string;
}

const DEFAULT_SAMPLES: Student[] = [
  {
    id: "student-1",
    name: "김민수",
    selfDescription: "수학과 과학 시간은 너무 재미있어서 깊게 파고들지만, 가끔 발표할 때 긴장이 많이 되고 수줍습니다. 체육을 아주 좋아합니다.",
    strengths: [
      { trait: "수학적/분석력", rating: 9 },
      { trait: "성실성", rating: 8 }
    ],
    weaknesses: [
      { trait: "학습 집중력", rating: 5 }
    ],
    evaluation: "수학적 사고력 and 분석력이 탁월하여 어려운 심화 개념 문제도 포기하지 않고 구조화하여 해결하는 끈기가 눈에 띔. 늘 수업 준비에 철저하고 차분한 자세로 집중하는 성실한 태도를 선보임. 다만 토론과 발표 시 수줍어하는 성향이 있어 긴장을 하기도 하나, 적극적 경청 노력과 친구들의 생각을 온화하게 잘 수용하는 모습을 모범적으로 보여주며 함께 탐구해 나가는 발전을 거듭하고 있음. 우수한 신체 운동 신경을 바탕으로 체육 행사나 구기 경쟁 과정에서 학급 팀워크를 북돋는 데 크게 기여함.",
    feedback: "민수야! 네가 수학 문제를 깊고 예리하게 풀어내어 친구들에게 기쁨의 해결책을 제시할 때 선생님은 참 감탄한단다. 아주 근사하고 든든한 강점이야! 한편으로 발표할 때 가슴이 쿵쾅거리고 부끄러워도 피할 생각보단 친구들 이야기에 온 마음을 열고 경청하려는 매력이 참 멋져. 조금씩 긴장을 덜고 너의 생각을 소리 내며 전달해 본다면 네 가치가 더 널리 더 밝게 퍼질 것이라 장담해. 언제나 다재다능한 민수 화이팅!",
    status: "completed"
  },
  {
    id: "student-2",
    name: "이지민",
    selfDescription: "학급 회장으로서 행사가 있으면 앞장서서 준비하고 의견도 많이 냅니다. 하지만 제 뜻대로 친구들이 안 따라주면 가끔 예민해져서 상처를 줄 때가 있어 걱정입니다.",
    strengths: [
      { trait: "리더십", rating: 10 },
      { trait: "창의적 사고", rating: 9 }
    ],
    weaknesses: [
      { trait: "배려심", rating: 6 }
    ],
    evaluation: "학급 전반의 크고 작은 행사 기획 및 학업 촉진 과정에 항상 주도적으로 교우들과 호흡하며 능동적인 지도력을 발휘함. 문제 해결과 협력 활동에서 참신하고 개성 있는 방안들을 창의적으로 제안하며 학급 활성화에 이바지함. 간혹 모둠 활동 진행 가치관이 맞지 않을 때 조바심을 부리는 모습이 있었으나, 점차 다른 급우의 의견을 차분하게 수용하는 조화성을 배양해 가며 원만하게 의견을 조율해 냄. 풍부한 언어 능력과 문예적 이해도를 두루 겸비하여 글쓰기 등의 인문 영역 표현력에 강점을 나타냄.",
    feedback: "지민아! 언제나 학급의 등대처럼 활력 있는 의견으로 친구들을 든든히 이끌어 주고, 반의 다양한 행사에 솔선수범해 주어 정말 고맙단다. 리더의 어깨가 무거운 만큼 친구들의 조그만 소극성에 가끔 상처를 입거나 목소리가 단호해져 속상했을 텐데, 남들의 생각 차이를 '성장의 무대'로 보고 부드럽고 온화하게 품어내는 연습을 해나가니 지민이의 리더로서의 품격이 물씬 올라가는 게 보이는구나. 고마운 우리 지민이, 언제나 응원한다!",
    status: "completed"
  }
];

let sharedStudentsStore: Student[] = [...DEFAULT_SAMPLES];

// Initialize the default GoogleGenAI SDK using process.env.GEMINI_API_KEY
let defaultAiClient: GoogleGenAI | null = null;

function getGeminiClient(customKey?: string): GoogleGenAI {
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is missing and no custom key was provided.");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. API: Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasBuiltInGeminiKey: !!process.env.GEMINI_API_KEY,
  });
});

// 1.1 API: Retrieve all synchronized students
app.get("/api/shared-students", (req, res) => {
  res.json(sharedStudentsStore);
});

// 1.2 API: Add or edit a single student (Also used by student response form submissions)
app.post("/api/shared-students", (req, res) => {
  const studentData = req.body;
  if (!studentData.name) {
    res.status(400).json({ error: "학생 성명은 필수 정보입니다." });
    return;
  }

  const existingIndex = sharedStudentsStore.findIndex(s => s.id === studentData.id);
  if (existingIndex > -1) {
    sharedStudentsStore[existingIndex] = {
      ...sharedStudentsStore[existingIndex],
      ...studentData,
      updatedAt: new Date().toISOString()
    };
    res.json(sharedStudentsStore[existingIndex]);
  } else {
    const newStudentInstance: Student = {
      id: studentData.id || `student-${Date.now()}`,
      name: studentData.name,
      selfDescription: studentData.selfDescription || "",
      strengths: studentData.strengths || [],
      weaknesses: studentData.weaknesses || [],
      evaluation: studentData.evaluation || "",
      feedback: studentData.feedback || "",
      status: studentData.status || "idle",
      updatedAt: new Date().toISOString()
    };
    sharedStudentsStore.push(newStudentInstance);
    res.json(newStudentInstance);
  }
});

// 1.3 API: Bulk replace the roster from the teacher's state
app.post("/api/shared-students/bulk", (req, res) => {
  const { students } = req.body;
  if (Array.isArray(students)) {
    sharedStudentsStore = students;
    res.json({ success: true, count: sharedStudentsStore.length });
  } else {
    res.status(400).json({ error: "올바른 리스트 형식의 학생 배열 정보가 필요합니다." });
  }
});

// 1.4 API: Delete a student by ID
app.delete("/api/shared-students/:id", (req, res) => {
  const { id } = req.params;
  sharedStudentsStore = sharedStudentsStore.filter(s => s.id !== id);
  res.json({ success: true });
});

// 1.5 API: Reset store to default system samples
app.post("/api/shared-students/reset", (req, res) => {
  const { action } = req.body;
  if (action === "clear") {
    sharedStudentsStore = [];
  } else {
    sharedStudentsStore = [...DEFAULT_SAMPLES];
  }
  res.json({ success: true, count: sharedStudentsStore.length });
});

// 2. API: Generate School Evaluation or Counselor Advice
app.post("/api/generate", async (req, res) => {
  try {
    const { student, type, config } = req.body;

    if (!student) {
      res.status(400).json({ error: "학생 데이터가 필요합니다." });
      return;
    }

    const { name, strengths, weaknesses, selfDescription } = student;
    const strengthsStr = strengths.map((s: { trait: string; rating: number }) => `${s.trait}(${s.rating}점)`).join(", ");
    const weaknessesStr = weaknesses.map((w: { trait: string; rating: number }) => `${w.trait}(${w.rating}점)`).join(", ");

    // Build the Prompt depending on generation type
    let prompt = "";
    let systemInstruction = "";

    if (type === "evaluation") {
      // School record (생활기록부용 행동특성 및 종합의견)
      systemInstruction = "너는 학생 지도 경력이 풍부하고 따뜻한 시각을 지닌 대한민국의 노련한 초중고 학급 담임 교사야.";
      prompt = `다음 학생의 핵심 특성을 바탕으로 학교 학교생활기록부 기재용 '행동특성 및 종합의견' 평가문을 정성껏 작성해주세요.

학생과 친근하게 지냈던 관찰 결과를 바탕으로 기재 규정을 완벽하게 만족해야 합니다.

[학생 정보]
이름: ${name}
강점(장점): ${strengthsStr || "없음"}
약점(보완점): ${weaknessesStr || "없음"}
학생 본인의 자기평가 내용: ${selfDescription || "없음"}

[중요 작성 규칙 - 반드시 지킬 것]
1. 모든 문장은 생활기록부 공문서 형식에 맞게 반드시 어미를 '~보임', '~씀', '~음', '~함', '~됨' 등으로 정중하고 명료하게 끝맺음해야 합니다. (예: '~활동에 적극 참여함', '~이해심이 넓어 친구들에게 인기가 많음', '~지도력을 발휘함')
2. 문장은 존댓말('~수행합니다', '~것입니다')이나 친근체('~해보자', '~잘했어')를 절대 사용하지 않습니다.
3. 강점을 부각해서 약 70~80% 비중으로 심층 서술하되, 약점은 20~30% 정도로 서술하며 단순히 지적이 아니라 단점을 충분히 이겨내고 해결책을 찾는 '발전 가능성 및 극복 노력'의 관점으로 매끄럽게 포장해 주어야 합니다.
4. 구체적인 교과 태도와 다른 친구들과의 조화로운 관계, 학업 열정도 입체적으로 언급합니다.
5. 학습 태도와 관련된 사항은 가급적 문장의 초반에 기재하고, 예체능 능력이나 특기사항 등이 있다면 가장 마지막(어미부)에 자연스럽게 이어지게 마무리합니다.
6. 전체 문장의 길이는 공백 포함 300자 이상 400자 이하로 적절히 맞추고, 중간에 불필요한 줄바꿈(엔터)이나 마크다운(#, *, -, \` 등)은 절대 사용하지 말고 연속된 긴 단락 하나로 작성해 주어야 합니다.
7. '학생은' 또는 '이 학생은', '그는'과 같은 상투적인 주어는 문맥상 자연스럽게 생략하고 서술어 중심의 주격 생략 형태로 기재합니다.
8. 학생이 작성한 자기평가 내용(${selfDescription})을 자연스럽게 분석하고 수렴하여, 본인의 성찰 성향을 좋게 반영해 줍니다.`;
    } else {
      // Counselor Feedback (학생 성장을 돕는 상담/성장 조언)
      systemInstruction = "너는 교육심리학적 전문성과 다정한 위로 능력을 갖춘 대한민국의 따뜻한 전문 상담교사(클래스 멘토)야.";
      prompt = `다음 학생의 강점과 약점, 자기평가를 확인한 후, 학생의 자존감을 높이고 긍정적인 성장을 독려하는 '성장 맞춤형 상담 편지'를 작성해줘.

[학생 정보]
이름: ${name}
강점: ${strengthsStr || "없음"}
약점: ${weaknessesStr || "없음"}
자기평가: ${selfDescription || "없음"}

[중요 작성 규칙]
1. 격려가 가득 담긴 친근하고 정겨운 대화체(반말, 예: '~하길 바랄게', '~하는 모습이 정말 멋져', '~선생님은 너의 성장을 응원해')로 은은하고 다정하게 말해줘.
2. 이름(${name})을 본문에 자연스럽게 부르되, 문장이 딱딱하지 않고 부드럽게 흐르도록 작성해야 해.
3. 강점을 진심으로 축하하고 극찬해 주며, 약점은 보완할 수 있는 긍정적인 방향의 성장 미션으로 따뜻하게 감싸 안아줘.
4. 편지의 끝부분에 아무런 문맥 없이 기계적으로 '고마워, [이름]아!' 혹은 '인사하고 끝내기'처럼 뜬금없는 감사 인사나 어색한 구절을 붙여 마무리하지 말고, 학생의 자존감을 키우는 진정성 넘치는 덕담과 따뜻한 다짐 및 응원 문장으로 세련되고 마음 깊이 마무리해 줘.
5. 중간에 마크다운 기호(*, #, \` 등)는 일체 제외하고, 가독성 좋은 줄바꿈과 넉넉하고 편안한 단락 구성으로 300자 내외로 작성해 줘.`;
    }

    const targetService = config?.service || "built-in";
    const customKey = config?.apiKey;

    if (targetService === "custom-openai") {
      // Call Custom OpenAI API via fetch (gpt-4o-mini as set in gas or a model selected)
      const openaiKey = customKey;
      if (!openaiKey) {
        res.status(400).json({ error: "OpenAI API 키가 설정되지 않았습니다." });
        return;
      }

      const modelName = config.model || "gpt-4o-mini";
      const requestPayload = {
        model: modelName,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
      }

      const responseData = await response.json();
      const generatedText = responseData.choices?.[0]?.message?.content || "";
      res.json({ result: generatedText.trim() });

    } else {
      // Call Gemini via official SDK (built-in or custom key)
      const isCustom = targetService === "custom-gemini";
      const geminiKey = isCustom ? customKey : process.env.GEMINI_API_KEY;

      if (!geminiKey) {
        res.status(400).json({
          error: isCustom 
            ? "사용자정의 Gemini API 키가 입력되지 않았습니다. 설정 모달에서 입력하시거나 '기본 탑재 AI'로 전환하세요." 
            : "서버에 기본 탑재된 GEMINI_API_KEY가 없습니다. '설정' 탭에서 본인의 API 키를 등록하여 이용하세요."
        });
        return;
      }

      const ai = getGeminiClient(geminiKey);
      const modelName = isCustom ? (config.model || "gemini-3.5-flash") : "gemini-3.5-flash";

      const apiResponse = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });

      const responseText = apiResponse.text || "";
      res.json({ result: responseText.trim() });
    }

  } catch (error: any) {
    console.error("AI Generation server error:", error);
    res.status(500).json({ error: error.message || "AI 생성 프로세스 진행 중 에러가 발생했습니다." });
  }
});

// Configure Vite integration or static file serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started and listening on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
