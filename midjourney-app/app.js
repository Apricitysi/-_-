(function() {
	'use strict';

	// Configuration
	const MAX_HISTORY = 20;
	const DEFAULT_PROMPT = (window.__DEFAULT_PROMPT__ || '').trim();

	// Elements
	const promptInput = document.getElementById('prompt-input');
	const promptLengthEl = document.getElementById('prompt-length');
	const optimizeBtn = document.getElementById('optimize-btn');
	const generateBtn = document.getElementById('generate-btn');
	const downloadAllBtn = document.getElementById('download-all-btn');
	const resultsGuidance = document.getElementById('results-guidance');
	const progressEl = document.getElementById('progress');
	const progressText = document.getElementById('progress-text');
	const progressBarFill = document.getElementById('progress-bar-fill');
	const resultsGrid = document.getElementById('results-grid');
	const referenceInput = document.getElementById('reference-input');
	const referenceGrid = document.getElementById('reference-grid');
	const dropzone = document.getElementById('reference-dropzone');
	const historySection = document.getElementById('history-section');
	const historyToggle = document.getElementById('history-toggle');
	const historyContent = document.getElementById('history-content');
	const historyItemTemplate = document.getElementById('history-item-template');

	// Modal elements
	const modal = document.getElementById('preview-modal');
	const modalClose = document.getElementById('modal-close');
	const modalImage = document.getElementById('modal-image');
	const modalThumbs = document.getElementById('modal-thumbs');
	const modalDownload = document.getElementById('modal-download');

	// In-memory state
	let currentResults = [];
	let currentPreviewIndex = 0;
	let referenceImages = []; // Array of {name, type, dataUrl}

	// Initialize
	function initialize() {
		if (DEFAULT_PROMPT) {
			promptInput.value = DEFAULT_PROMPT;
			updatePromptLength();
		}
		bindUI();
		loadHistory();
	}

	// Bind events
	function bindUI() {
		promptInput.addEventListener('input', updatePromptLength);
		optimizeBtn.addEventListener('click', onOptimizePrompt);
		generateBtn.addEventListener('click', onGenerate);
		downloadAllBtn.addEventListener('click', onDownloadAll);

		referenceInput.addEventListener('change', onReferenceFiles);
		dropzone.addEventListener('click', () => referenceInput.click());
		dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
		dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
		dropzone.addEventListener('drop', (e) => {
			e.preventDefault(); dropzone.classList.remove('dragover');
			handleFiles(e.dataTransfer.files);
		});

		historyToggle.addEventListener('click', toggleHistory);

		// Modal events
		modal.addEventListener('click', (e) => {
			if (e.target.dataset.close === 'true') closeModal();
		});
		modalClose.addEventListener('click', closeModal);
		document.addEventListener('keydown', onKeyNav);
	}

	function updatePromptLength() {
		promptLengthEl.textContent = `${promptInput.value.length} chars`;
	}

	// Reference images
	function onReferenceFiles(e) { handleFiles(e.target.files); e.target.value = ''; }
	function handleFiles(fileList) {
		const files = Array.from(fileList || []).filter(f => /image\//.test(f.type));
		if (!files.length) return;
		Promise.all(files.map(readFileAsDataUrl)).then(newImgs => {
			referenceImages = referenceImages.concat(newImgs);
			renderReferenceGrid();
		});
	}
	function readFileAsDataUrl(file) {
		return new Promise(resolve => {
			const reader = new FileReader();
			reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
			reader.readAsDataURL(file);
		});
	}
	function renderReferenceGrid() {
		referenceGrid.innerHTML = '';
		referenceImages.forEach((img, idx) => {
			const wrap = document.createElement('div');
			wrap.className = 'reference-item';
			const image = new Image(); image.loading = 'lazy'; image.src = img.dataUrl; image.alt = img.name;
			const remove = document.createElement('button'); remove.className = 'reference-remove'; remove.textContent = 'Remove';
			remove.addEventListener('click', () => { referenceImages.splice(idx, 1); renderReferenceGrid(); });
			wrap.appendChild(image); wrap.appendChild(remove);
			referenceGrid.appendChild(wrap);
		});
	}

	// Prompt optimizer (Claude-4-Sonnet via Youware). Fallback to local improvement if SDK not present.
	async function onOptimizePrompt() {
		const input = promptInput.value.trim();
		if (!input) return;
		setLoading(true, 'Optimizing prompt…');
		try {
			const optimized = await optimizePromptWithClaude(input);
			promptInput.value = optimized || input;
			updatePromptLength();
		} catch (err) {
			console.error(err);
			toast('Prompt optimization failed. Using a locally enhanced version.');
			promptInput.value = localOptimizePrompt(input);
			updatePromptLength();
		} finally {
			setLoading(false);
		}
	}

	function localOptimizePrompt(input) {
		const base = input.replace(/\s+/g, ' ').trim();
		const extras = [
			"highly detailed, intricate textures, dramatic lighting",
			"8k, ultra realistic, sharp focus, global illumination",
			"cinematic composition, rule of thirds, volumetric fog",
		].join(', ');
		return `${base}, ${extras}`;
	}

	async function optimizePromptWithClaude(input) {
		// If Youware OpenAI-like SDK exists, attempt to call claude-4-sonnet
		if (window.youwareOpenAI && window.youwareOpenAI.chat) {
			const system = `You are a professional Midjourney prompt engineer. Transform user ideas into rich, production-grade prompts. Structure your output with: subject, environment, style, technical parameters, mood. Emphasize color, texture, lighting. Output a single optimized prompt without explanation.`;
			const response = await window.youwareOpenAI.chat.completions.create({
				model: 'claude-4-sonnet',
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: input }
				],
			});
			const content = (response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) || '';
			return content.trim();
		}
		// Fallback
		return localOptimizePrompt(input);
	}

	// Generate images (Midjourney via Youware). Fallback to placeholder images if SDK absent.
	async function onGenerate() {
		const prompt = promptInput.value.trim();
		if (!prompt) { toast('Please enter a prompt.'); return; }
		resetResultsUI();
		setProgress(0, 'Queuing…');
		setLoading(true);
		try {
			const images = await generateWithMidjourney(prompt, referenceImages);
			currentResults = images;
			renderResults(images);
			saveHistoryRecord({ prompt, images });
			updateDownloadState();
			showHistorySection();
		} catch (err) {
			console.error(err);
			toast('Image generation failed. Please try again.');
		} finally {
			setLoading(false);
		}
	}

	async function generateWithMidjourney(prompt, refs) {
		// Simulated progress
		await simulateProgress();
		if (window.youwareAI && window.youwareAI.images) {
			const response = await window.youwareAI.images.generate({
				model: 'midjourney',
				prompt,
				references: refs && refs.length ? refs.map(r => r.dataUrl) : undefined,
				count: 4,
				response_format: 'url'
			});
			const urls = (response && response.data) ? response.data.map(d => d.url) : [];
			if (urls.length === 4) return urls;
		}
		// Fallback placeholders (client-only demo)
		const seed = Math.random().toString(36).slice(2, 8);
		return [0,1,2,3].map(i => `https://picsum.photos/seed/${seed}-${i}/768/1024`);
	}

	function resetResultsUI() {
		resultsGuidance.classList.add('hidden');
		resultsGrid.innerHTML = '';
		progressEl.classList.remove('hidden');
		progressText.textContent = 'Initializing… 0%';
		progressBarFill.style.width = '0%';
		downloadAllBtn.disabled = true;
	}

	function setLoading(isLoading, label) {
		generateBtn.disabled = !!isLoading;
		optimizeBtn.disabled = !!isLoading;
		if (typeof label === 'string') {
			progressText.textContent = label;
		}
	}

	function setProgress(percent, label) {
		progressEl.classList.remove('hidden');
		progressBarFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
		if (label) progressText.textContent = `${label} ${percent}%`;
	}

	async function simulateProgress() {
		let p = 0;
		while (p < 100) {
			await delay(200 + Math.random() * 200);
			p = Math.min(100, p + Math.round(8 + Math.random() * 14));
			setProgress(p, 'Generating…');
		}
	}

	function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

	function renderResults(urls) {
		progressEl.classList.add('hidden');
		resultsGrid.innerHTML = '';
		urls.forEach((url, idx) => {
			const card = document.createElement('div');
			card.className = 'result';
			const img = new Image(); img.loading = 'lazy'; img.src = url; img.alt = `Generated image ${idx+1}`;
			const btn = document.createElement('button');
			btn.addEventListener('click', () => openModal(idx));
			card.appendChild(img); card.appendChild(btn);
			resultsGrid.appendChild(card);
		});
	}

	function updateDownloadState() { downloadAllBtn.disabled = !(currentResults && currentResults.length); }

	async function onDownloadAll() {
		if (!currentResults.length) return;
		for (let i = 0; i < currentResults.length; i++) {
			await downloadImage(currentResults[i], `midjourney_${Date.now()}_${i+1}.jpg`);
		}
	}

	function openModal(index) {
		currentPreviewIndex = index;
		modal.classList.remove('hidden');
		updateModalImage();
		renderModalThumbs();
	}
	function closeModal() { modal.classList.add('hidden'); }
	function onKeyNav(e) {
		if (modal.classList.contains('hidden')) return;
		if (e.key === 'Escape') return closeModal();
		if (e.key === 'ArrowRight') { currentPreviewIndex = (currentPreviewIndex + 1) % currentResults.length; updateModalImage(); setActiveThumb(); }
		if (e.key === 'ArrowLeft') { currentPreviewIndex = (currentPreviewIndex - 1 + currentResults.length) % currentResults.length; updateModalImage(); setActiveThumb(); }
	}
	function updateModalImage() {
		const url = currentResults[currentPreviewIndex];
		modalImage.src = url; modalDownload.href = url;
	}
	function renderModalThumbs() {
		modalThumbs.innerHTML = '';
		currentResults.forEach((url, idx) => {
			const img = new Image(); img.loading = 'lazy'; img.src = url; img.alt = `Result ${idx+1}`;
			if (idx === currentPreviewIndex) img.classList.add('active');
			img.addEventListener('click', () => { currentPreviewIndex = idx; updateModalImage(); setActiveThumb(); });
			modalThumbs.appendChild(img);
		});
	}
	function setActiveThumb() {
		Array.from(modalThumbs.children).forEach((el, i) => {
			if (i === currentPreviewIndex) el.classList.add('active'); else el.classList.remove('active');
		});
	}

	// Downloads
	async function downloadImage(url, filename) {
		const a = document.createElement('a');
		a.href = url; a.download = filename || 'image.jpg';
		document.body.appendChild(a); a.click(); a.remove();
	}

	// History
	function showHistorySection() { historySection.hidden = false; }
	function toggleHistory() {
		const expanded = historyToggle.getAttribute('aria-expanded') === 'true';
		historyToggle.setAttribute('aria-expanded', String(!expanded));
		historyContent.hidden = expanded;
	}
	function saveHistoryRecord({ prompt, images }) {
		const rec = { id: Date.now(), prompt, images, ts: new Date().toISOString() };
		const list = loadHistoryList();
		list.unshift(rec);
		if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
		localStorage.setItem('mj_history', JSON.stringify(list));
		renderHistory(list);
	}
	function loadHistoryList() {
		try { return JSON.parse(localStorage.getItem('mj_history') || '[]'); }
		catch { return []; }
	}
	function loadHistory() { renderHistory(loadHistoryList()); if (loadHistoryList().length) showHistorySection(); }
	function renderHistory(list) {
		historyContent.innerHTML = '';
		list.forEach(item => {
			const node = historyItemTemplate.content.cloneNode(true);
			node.querySelector('.history-prompt').textContent = item.prompt;
			node.querySelector('.history-meta').textContent = new Date(item.ts).toLocaleString();
			const imagesWrap = node.querySelector('.history-images');
			item.images.forEach((url, idx) => {
				const img = new Image(); img.loading = 'lazy'; img.src = url; img.alt = `History image ${idx+1}`;
				img.addEventListener('click', () => { currentResults = item.images; openModal(idx); });
				imagesWrap.appendChild(img);
			});
			historyContent.appendChild(node);
		});
	}

	// Toast
	function toast(message) {
		console.warn(message);
	}

	// Init
	initialize();
})();

