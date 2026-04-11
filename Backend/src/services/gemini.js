import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash-preview-05-20',
  generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
})

// Helper - call Gemini and always return parsed JSON
async function callGemini(prompt) {
  const result = await model.generateContent(prompt)
  const text = result.response.text()
  // Strip markdown code fences if Gemini adds them
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// -----------------------------------------------
// 1. ANALYZE MODULE OVERVIEW
// Reads the overview text and returns structured topics
// -----------------------------------------------
export async function analyzeModuleOverview({ name, credits, midMark, midWeight, confidenceRating, overviewText, targetGrade, weeksLeft }) {
  const prompt = `
You are an academic study planner AI.

Analyze this university module and return a JSON object with two keys: "topics" and "recommendedHours".

Module details:
- Name: ${name}
- Credits: ${credits}
- Mid-exam mark: ${midMark !== null ? midMark + '%' : 'Not taken yet'}
- Mid-exam weight: ${midWeight}%
- Student confidence rating: ${confidenceRating}/5 (1=needs most focus, 5=very comfortable)
- Target grade: ${targetGrade}
- Weeks until exam: ${weeksLeft}
- Final exam weight: ${100 - midWeight}%

Module overview document:
---
${overviewText?.slice(0, 6000) || 'No overview provided'}
---

Calculate:
1. What final exam percentage the student needs to achieve their target grade
2. How many hours per week they should study this module, considering:
   - Credit weight (more credits = more content)
   - Mid mark (lower mark = needs more catch-up hours)
   - Confidence rating (lower rating = allocate more hours)
   - Content density from the overview
   - Weeks remaining (fewer weeks = more hours per week)

Return ONLY this JSON structure, no explanation, no markdown:
{
  "topics": [
    {
      "topic": "Topic name",
      "weight": "high | medium | low",
      "subtopics": ["subtopic1", "subtopic2"]
    }
  ],
  "recommendedHours": {
    "perWeek": 8.5,
    "totalNeeded": 42,
    "reasoning": "One paragraph explaining why this many hours, referencing mid mark, confidence, content density specifically.",
    "breakdown": {
      "midMarkContribution": "You scored 41% on the mid. You need X% in finals. This adds Y hours.",
      "confidenceContribution": "Rating 1/5 means significant gaps. Added Z hours.",
      "contentContribution": "Overview shows 9 major topics including heavy areas like X and Y."
    }
  }
}
`
  return await callGemini(prompt)
}

// -----------------------------------------------
// 2. GRADE SESSION SUMMARY
// Student writes what they studied, Gemini grades it
// -----------------------------------------------
export async function gradeSessionSummary({ moduleName, summary, durationMinutes, topics, recentSessions }) {
  const topicList = topics?.map(t => t.topic).join(', ') || 'unknown'
  const recentScores = recentSessions?.map(s => s.efficiency_score).filter(Boolean) || []
  const trend = recentScores.length
    ? `Recent scores: ${recentScores.slice(0,5).join(', ')}. `
    : 'No previous sessions for this module.'

  const prompt = `
You are grading a student's study session summary.

Module: ${moduleName}
Session duration: ${durationMinutes} minutes
Key exam topics: ${topicList}
${trend}

Student's summary:
"${summary}"

Grade this session honestly. Consider:
- Depth of understanding shown (did they explain concepts or just list them?)
- Relevance to exam topics
- Whether they identified gaps or uncertainties (good self-awareness)
- Compared to their recent trend

Return ONLY this JSON, no markdown:
{
  "score": 78,
  "label": "Solid Focus",
  "feedback": "One specific encouraging sentence referencing what they actually wrote.",
  "tip": "One concrete actionable suggestion for their next session on this module.",
  "topicsCovered": ["exact topic names from the module topics list that they covered"],
  "trendNote": "One sentence comparing to recent performance, or encouraging start if first session."
}

Score guide: 90-100=Deep Work, 75-89=Solid Focus, 60-74=Needs Depth, below 60=Surface Level
Labels must match score ranges above exactly.
`
  return await callGemini(prompt)
}

// -----------------------------------------------
// 3. WEEKLY PROGRESS ANALYSIS
// Looks at the whole week and gives a summary
// -----------------------------------------------
export async function analyzeWeeklyProgress({ modules, weekSessions, weeksLeft }) {
  const modulesSummary = modules.map(m => ({
    name: m.name,
    recommendedHoursPerWeek: m.recommended_hours?.perWeek || 0,
    sessionsThisWeek: weekSessions.filter(s => s.module_id === m.id).length,
    avgEfficiency: (() => {
      const scores = weekSessions
        .filter(s => s.module_id === m.id && s.efficiency_score)
        .map(s => s.efficiency_score)
      return scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : null
    })()
  }))

  const prompt = `
A student is ${weeksLeft} weeks from their final exams.

This week's performance per module:
${JSON.stringify(modulesSummary, null, 2)}

Return ONLY this JSON:
{
  "overallScore": 74,
  "weekLabel": "Productive Week",
  "highlights": ["One specific thing they did well this week"],
  "concerns": ["One specific module or pattern that needs attention"],
  "nextWeekFocus": "One concrete recommendation for next week's priorities"
}
`
  return await callGemini(prompt)
}
