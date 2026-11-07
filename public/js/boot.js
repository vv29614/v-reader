/* 启动引导：PDF 引擎按需加载（只在打开 PDF 时才下载 344KB 的解析器） */
window.loadPdfJs = async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const lib = await import('../vendor/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
  window.pdfjsLib = lib;
  return lib;
};

await import('./app.js?v=20261107reader');
