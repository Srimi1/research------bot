import type { ProjectDetail } from './types';
export function markdownExport(detail:ProjectDetail):string {
  const {project,sources,steps}=detail;
  return `# ${project.title}\n\nTopic: ${project.topic}\n\n## Research question\n\n${project.question}\n\n## Notes\n\n${project.notes}\n\n## Accepted research plan\n\n${steps.map((s,i)=>`${i+1}. [${s.done?'x':' '}] ${s.title}\n   Purpose: ${s.purpose}\n   Output: ${s.output}\n   Depends on: ${s.dependsOn}\n   Completion check: ${s.check}`).join('\n\n')}\n\n## Source library\n\n${sources.map(s=>`### ${s.title}\n\n${s.authors.join(', ')} (${s.year||'date unavailable'})\n\nURL: ${s.url}\nDOI: ${s.doi||'unavailable'}\nCategory: ${s.category}\nInspected: ${s.inspected}\nRetrieved: ${s.retrievedAt}\nSearch query: ${s.query}\n\nMethod: ${s.method||'not recorded'}\nFindings: ${s.findings||'not recorded'}\nLimitations: ${s.limitations||'not recorded'}\n\nReading notes: ${s.notes}`).join('\n\n')}\n`;
}
