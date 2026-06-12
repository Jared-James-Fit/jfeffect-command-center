const fs = require('fs');
let content = fs.readFileSync('src/routes/_authenticated/admin/media-archives.tsx', 'utf8');

const oldFn = /const handleRetry = async \(id: string\) => \{[\s\S]*?async \(e: any\) \{ toast\.error\(e\?\.message \?\? "Retry failed"\); \}[\s\S]*?\};/;
const newFn = `const handleRetry = async (id: string) => {
    await runJob({
      title: "Archiving to Drive",
      steps: ["Upload complete", "Preparing archive", "Sending to Google Drive", "Saving archive status", "Finalized"],
      successToast: "Archived to Drive",
    }, async (job) => {
      job.completeStep(); // Upload complete
      job.setStatusText("Preparing archive...");
      
      const r: any = await retryFn({ data: { archiveId: id } });
      if (!r.ok) throw new Error(r.error ?? "Retry failed");
      
      job.completeStep(); // Preparing archive
      job.completeStep(); // Sending to Google Drive
      job.completeStep(); // Saving archive status
      job.completeStep(); // Finalized
      
      qc.invalidateQueries({ queryKey: ["media-archives"] });
    });
  };`;

content = content.replace(oldFn, newFn);
fs.writeFileSync('src/routes/_authenticated/admin/media-archives.tsx', content);
