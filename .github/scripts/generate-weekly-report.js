const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const days = Math.min(Math.max(Number.parseInt(process.env.REPORT_DAYS || "7", 10) || 7, 1), 31);
const repository = process.env.GITHUB_REPOSITORY || "unknown/repository";
const token = process.env.GITHUB_TOKEN;
const outputDir = process.env.REPORT_OUTPUT_DIR || "weekly-report-output";
const now = new Date();
const since = new Date(now.getTime() - days * 86400000);
const keywords = [
  "inventory", "stock", "product", "warehouse", "purchase", "sales", "history",
  "approval", "barcode", "bom", "cost", "reorder", "재고", "입고", "출고",
  "발주", "바코드", "원가", "수량", "품절", "과잉재고"
];
const fileHints = [
  "inventory", "product", "warehouse", "purchase", "sales", "history",
  "approval", "barcode", "bom", "migration"
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function relevant(text, files = "") {
  const haystack = `${text}\n${files}`.toLowerCase();
  return keywords.some((word) => haystack.includes(word)) ||
    fileHints.some((word) => files.toLowerCase().includes(word));
}

function bullet(items, emptyText) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${emptyText}`;
}

async function fetchPullRequests() {
  if (!token || !repository.includes("/")) return [];
  const url = `https://api.github.com/repos/${repository}/pulls?state=all&sort=updated&direction=desc&per_page=50`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) throw new Error(`GitHub PR 조회 실패: ${response.status}`);
  const pulls = await response.json();
  return pulls.filter((pr) => new Date(pr.updated_at) >= since && relevant(`${pr.title}\n${pr.body || ""}`));
}

async function main() {
  const format = "%H%x1f%aI%x1f%s%x1f%b%x1e";
  const raw = git(["log", `--since=${since.toISOString()}`, `--format=${format}`, "--name-only", "HEAD"]);
  const commits = raw ? raw.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [header, ...fileLines] = record.split("\n");
    const [sha, date, subject, body = ""] = header.split("\x1f");
    const files = fileLines.filter(Boolean).join(", ");
    return { sha, date, subject, body, files };
  }).filter((commit) => relevant(`${commit.subject}\n${commit.body}`, commit.files)) : [];

  let pulls = [];
  let prWarning = "";
  try {
    pulls = await fetchPullRequests();
  } catch (error) {
    prWarning = error.message;
  }

  const completed = pulls.filter((pr) => pr.merged_at).map((pr) =>
    `PR #${pr.number} ${pr.title} ([링크](${pr.html_url}))`
  );
  const inProgress = pulls.filter((pr) => pr.state === "open").map((pr) =>
    `PR #${pr.number} ${pr.title} ([링크](${pr.html_url}))`
  );
  const commitItems = commits.map((commit) =>
    `${commit.subject} ([${commit.sha.slice(0, 7)}](https://github.com/${repository}/commit/${commit.sha}))`
  );

  const risks = [];
  if (!commits.length && !pulls.length) risks.push("해당 기간에 재고 관련 GitHub 변경이 확인되지 않았습니다.");
  if (prWarning) risks.push(`PR 수집 경고: ${prWarning}`);
  risks.push("커밋·PR만으로는 실제 현장 적용 및 통합 테스트 완료 여부를 확정할 수 없습니다.");

  const period = `${since.toISOString().slice(0, 10)} ~ ${now.toISOString().slice(0, 10)}`;
  const report = `# ERP 재고관리 주간 진행 보고

- 보고 기간: ${period}
- 작성자: 김세현
- 대상 저장소: ${repository}
- 생성 시각: ${now.toISOString()}

## 1. 이번 주 완료 사항
${bullet([...completed, ...commitItems], "완료로 분류된 재고 관련 변경이 없습니다.")}

## 2. 진행 중인 사항
${bullet(inProgress, "진행 중으로 확인된 재고 관련 PR이 없습니다.")}

## 3. 테스트 및 확인 결과
- GitHub 커밋 및 PR 기록 수집 완료
- 실제 실행·DB 통합 테스트 결과는 담당자 확인 필요

## 4. 문제점 및 위험요소
${bullet(risks, "확인된 위험요소가 없습니다.")}

## 5. 다음 주 계획
- 열린 재고 관련 PR 검토 및 처리
- 변경 기능의 실제 실행·DB 통합 테스트
- 보고서 내용을 실제 업무 진행 상황과 대조

## 6. 결정 또는 지원 필요 사항
- 병합, 배포 또는 외부 공유가 필요한 항목은 별도 승인 필요

---
> 이 문서는 GitHub 변경 이력을 바탕으로 자동 생성된 초안입니다. 최종 제출 전 실제 진행 상황과 테스트 결과를 확인해 주세요.
`;

  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `ERP_재고관리_주간보고_${now.toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(path.join(outputDir, fileName), report, "utf8");
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify({
    repository, period, commitCount: commits.length, pullRequestCount: pulls.length
  }, null, 2));
  console.log(`주간보고 초안 생성 완료: ${path.join(outputDir, fileName)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
