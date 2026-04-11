import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash-preview-05-20',
  generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
})

async function callGemini(prompt) {
  const result = await model.generateContent(prompt)
  const text = result.response.text()
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

export async function analyzeModuleOverview({ name, credits, midMark, midWeight, confidenceRating, overviewText, targetGrade, weeksLeft }) {
  const finalWeight = 100 - (midWeight || 0)
  const targetPct = targetGrade === 'A' ? 75 : targetGrade === 'B+' ? 70 : 65
  const neededFinal = midMark != null
    ? Math.round((targetPct - (midWeight / 100) * midMark) / (finalWeight / 100))
    : targetPct

  const prompt = `
You are an academic study planner AI. Analyze this university module and return structured JSON.

Module: ${name}
Credits: ${credits}
Mid-exam mark: ${midMark != null ? midMark + '%' : 'Not taken yet'}
Mid-exam weight: ${midWeight}%
Final exam weight: ${finalWeight}%
Student needs ${Math.max(0, neededFinal)}% in finals for ${targetGrade}
Student confidence: ${confidenceRating}/5 (1=needs most focus, 5=very comfortable)
Weeks until exam: ${weeksLeft}

Overview document:
---
${(overviewText || '').slice(0, 6000)}
---

Return ONLY this JSON, no markdown:
{
  "topics": [
    { "topic": "Topic name", "weight": "high|medium|low", "subtopics": ["sub1","sub2"] }
  ],
  "recommendedHours": {
    "perWeek": 8.5,
    "totalNeeded": 42,
    "reasoning": "Specific paragraph explaining hours based on their mid mark, confidence rating, content density.",
    "breakdown": {
      "midMarkContribution": "Specific sentence about mid mark impact",
      "confidenceContribution": "Specific sentence about confidence rating impact",
      "contentContribution": "Specific sentence about content volume from overview"
    }
  }
}
`
  return await callGemini(prompt)
}

export async function gradeSessionSummary({ moduleName, summary, durationMinutes, topics, recentSessions }) {
  const topicList = (topics || []).map(t => t.topic).join(', ') || 'general topics'
  const recentScores = (recentSessions || []).map(s => s.efficiency_score).filter(Boolean)
  const trendContext = recentScores.length
    ? `Recent session scores: ${recentScores.slice(0,5).join(', ')}`
    : 'This is their first session for this module.'

  const prompt = `
Grade this student's study session honestly.

Module: ${moduleName}
Duration: ${durationMinutes} minutes
Exam topics: ${topicList}
${trendContext}

Summary written by student:
"${summary}"

Score based on: depth shown, topic relevance, self-awareness of gaps.

Return ONLY this JSON, no markdown:
{
  "score": 78,
  "label": "Solid Focus",
  "feedback": "One specific sentence referencing what they actually wrote.",
  "tip": "One concrete actionable next-session suggestion.",
  "topicsCovered": ["topic names from the module list they actually covered"],
  "trendNote": "One sentence on trend vs recent sessions or encouragement if first."
}

Score ranges — label must match:
90-100: Deep Work
75-89: Solid Focus  
60-74: Needs Depth
0-59: Surface Level
`
  return await callGemini(prompt)
}

export async function analyzeWeeklyProgress({ modules, weekSessions, weeksLeft }) {
  const summary = modules.map(m => {
    const mSessions = weekSessions.filter(s => s.module_id === m.id)
    const scores = mSessions.map(s => s.efficiency_score).filter(Boolean)
    return {
      name: m.name,
      targetHoursPerWeek: m.recommended_hours?.perWeek || 0,
      sessionsCompleted: mSessions.length,
      avgEfficiency: scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : null
    }
  })

  const prompt = `
Student has ${weeksLeft} weeks until final exams.

This week per module:
${JSON.stringify(summary, null, 2)}

Return ONLY this JSON:
{
  "overallScore": 74,
  "weekLabel": "Productive Week",
  "highlights": ["One specific thing done well"],
  "concerns": ["One specific concern or module falling behind"],
  "nextWeekFocus": "One concrete recommendation for next week"
}
`
  return await callGemini(prompt)
}
