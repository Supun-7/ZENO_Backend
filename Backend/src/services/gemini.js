import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash-preview-05-20',
  generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
})

async function callGemini(prompt) {
  const result = await model.generateContent(prompt)
  const text   = result.response.text()
  const clean  = text.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, m =>
    m.replace(/```json\n?|```\n?/g, '')
  ).trim()
  // find first { or [ and parse from there
  const start = clean.search(/[\[{]/)
  if (start === -1) throw new Error('No JSON found in Gemini response')
  return JSON.parse(clean.slice(start))
}

// ─── 1. Analyze module overview ───────────────────────────────────────────────
export async function analyzeModuleOverview({
  name, credits, midMark, midWeight,
  confidenceRating, overviewText, targetGrade, weeksLeft
}) {
  const finalWeight = 100 - (midWeight || 0)
  const targetPct   = targetGrade === 'A' ? 75 : targetGrade === 'B+' ? 70 : 65
  const neededFinal = midMark != null && midWeight > 0
    ? Math.round((targetPct - (midWeight / 100) * midMark) / (finalWeight / 100))
    : targetPct

  const prompt = `
You are an academic study planner. Analyze this university module and return ONLY valid JSON.

Module: ${name}
Credits: ${credits}
Mid-exam mark: ${midMark != null ? midMark + '%' : 'Not taken yet'}
Mid-exam weight: ${midWeight}%
Final exam weight: ${finalWeight}%
Student needs ${Math.max(0, neededFinal)}% in finals to achieve ${targetGrade}
Confidence rating: ${confidenceRating}/5 (1=needs most focus, 5=very comfortable)
Weeks until exam: ${weeksLeft}
Available study hours per weekday: 6h (4 slots: 2h, 1h45m, 1h, 1h15m)

Overview:
---
${(overviewText || '').slice(0, 5000)}
---

Return this exact JSON structure:
{
  "topics": [
    { "topic": "string", "weight": "high|medium|low", "subtopics": ["string"] }
  ],
  "recommendedHours": {
    "perWeek": 10.5,
    "totalNeeded": 52,
    "reasoning": "Specific explanation referencing mid mark, confidence, content.",
    "breakdown": {
      "midMarkContribution": "one sentence",
      "confidenceContribution": "one sentence",
      "contentContribution": "one sentence"
    }
  }
}
`
  return await callGemini(prompt)
}

// ─── 2. Generate full study plan ──────────────────────────────────────────────
// Returns array of { date: "YYYY-MM-DD", slotKey: "S1", moduleId: "uuid" }
export async function generateStudyPlan({
  modules, startDate, examDate, weekdaySlots, satSlots, sunSlots
}) {
  // Build a compact representation for Gemini
  const moduleList = modules.map(m => ({
    id:           m.id,
    name:         m.name,
    hoursPerWeek: m.recommended_hours?.perWeek || 4,
    priority:     6 - (m.confidence_rating || 3), // invert: 1=comfortable→low priority
    credits:      m.credits
  }))

  const SLOT_DURATIONS = { S1: 120, S2: 105, S3: 60, S4: 75 }

  // Calculate total days
  const start = new Date(startDate)
  const end   = new Date(examDate)
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24))

  const prompt = `
You are a study schedule planner. Create a complete daily study schedule.

Start date: ${startDate}
Exam date: ${examDate}
Total days: ${totalDays}

Modules to schedule (with recommended hours per week):
${JSON.stringify(moduleList, null, 2)}

Available time slots per day:
- S1: 08:30-10:30 (120 min)
- S2: 10:45-12:30 (105 min)  
- S3: 13:30-14:30 (60 min)
- S4: 14:45-16:00 (75 min)

Weekday slots available: ${weekdaySlots.join(', ')}
Saturday slots available: ${satSlots.length > 0 ? satSlots.join(', ') : 'none (rest day)'}
Sunday slots available: ${sunSlots.length > 0 ? sunSlots.join(', ') : 'none (rest day)'}

Rules:
1. Assign modules to slots proportional to their hoursPerWeek target
2. Higher priority modules get more slots when there is a tie
3. Rotate modules so no module appears more than twice consecutively  
4. Leave weekend slots empty (status: rest) if not in the available list
5. Do not schedule anything on or after the exam date

Return ONLY a JSON array. Each item: { "date": "YYYY-MM-DD", "slotKey": "S1|S2|S3|S4", "moduleId": "uuid", "status": "pending|rest" }
Return every slot for every day from ${startDate} to one day before ${examDate}.
`

  const plan = await callGemini(prompt)
  return Array.isArray(plan) ? plan : []
}

// ─── 3. Grade session summary ─────────────────────────────────────────────────
export async function gradeSessionSummary({
  moduleName, summary, durationMinutes, topics, recentSessions
}) {
  const topicList    = (topics || []).map(t => t.topic).join(', ') || 'general topics'
  const recentScores = (recentSessions || []).map(s => s.efficiency_score).filter(Boolean)
  const trendCtx     = recentScores.length
    ? `Recent scores: ${recentScores.slice(0, 5).join(', ')}`
    : 'First session for this module.'

  const prompt = `
Grade this student study session. Return ONLY valid JSON.

Module: ${moduleName}
Duration: ${durationMinutes} minutes
Exam topics: ${topicList}
${trendCtx}

Student summary: "${summary}"

Return:
{
  "score": 78,
  "label": "Solid Focus",
  "feedback": "One specific encouraging sentence about what they wrote.",
  "tip": "One concrete next-session suggestion.",
  "topicsCovered": ["topic names from the list they covered"],
  "trendNote": "One sentence on trend or encouragement."
}

Score/label must match: 90-100=Deep Work, 75-89=Solid Focus, 60-74=Needs Depth, 0-59=Surface Level
`
  return await callGemini(prompt)
}

// ─── 4. Weekly progress analysis ──────────────────────────────────────────────
export async function analyzeWeeklyProgress({ modules, weekSessions, weeksLeft }) {
  const summary = modules.map(m => {
    const ms     = weekSessions.filter(s => s.module_id === m.id)
    const scores = ms.map(s => s.efficiency_score).filter(Boolean)
    return {
      name:              m.name,
      targetHoursPerWeek: m.recommended_hours?.perWeek || 0,
      sessionsCompleted: ms.length,
      avgEfficiency:     scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null
    }
  })

  const prompt = `
Student has ${weeksLeft} weeks until finals. Analyze this week.

${JSON.stringify(summary, null, 2)}

Return ONLY JSON:
{
  "overallScore": 74,
  "weekLabel": "Productive Week",
  "highlights": ["one specific positive"],
  "concerns": ["one specific concern"],
  "nextWeekFocus": "one concrete recommendation"
}
`
  return await callGemini(prompt)
}
