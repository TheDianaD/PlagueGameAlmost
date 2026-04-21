(function(storyContent) {
    'use strict';

    var story = new inkjs.Story(storyContent);
    var savePoint = "";
    var lastChoiceText = "";
    var vocabNoticeShown = false;
    var _prev = { money: null, grain: null };
    var _deltaTimer = null;
    var _pendingDeltas = [];

    // GLOBAL TAGS
    var globalTags = story.globalTags;
    if (globalTags) {
        globalTags.forEach(function(tag) {
            var t = splitTag(tag);
            if (t && t.key.toLowerCase() === 'author') {
                document.querySelectorAll('.byline, #byline-el').forEach(function(el) { 
                    el.textContent = 'by ' + t.val; 
                });
            }
        });
    }

    var storyEl = document.querySelector('#story');
    var scrollEl = document.querySelector('.outerContainer');

    setupButtons();
    savePoint = story.state.toJson();
    continueStory(true);

    function continueStory(firstTime) {
        var prevBottom = firstTime ? 0 : bottomEdge();
        var fragment = document.createDocumentFragment(); // Performance optimization for lag

        while (story.canContinue) {
            var text = story.Continue();
            var tags = story.currentTags;

            tags.forEach(function(tag) {
                var t = splitTag(tag);
                if (t) {
                    var key = t.key.toUpperCase().trim();
                    if (key.startsWith('JOURNAL')) {
                        var jSeason = key.slice('JOURNAL'.length).trim();
                        addJournalEntry(t.val.trim(), jSeason);
                    }
                } else if (tag.trim() === 'SHOW_DELTA') {
                    flushDelta();
                } else if (tag.trim() === 'RESTART') {
                    restart(); return;
                }
            });

            if (!text.trim()) continue;
            if (lastChoiceText && text.trim() === lastChoiceText.trim()) {
                lastChoiceText = ''; continue;
            }

            if (isVocabLine(text)) {
                extractVocab(text);
                if (!vocabNoticeShown && text.includes('VOCAB')) {
                    showVocabNotice();
                    vocabNoticeShown = true;
                }
                continue;
            }

            checkDeath(text);

            var p = document.createElement('p');
            p.innerHTML = text
                .replace(/(\d+)\s+(pennies|shillings|pence|bushels?|acres?|cows?|rabbits?)/gi, '<strong>$1 $2</strong>')
                .replace(/(\d+)%/g, '<strong>$1%</strong>');

            if (/^(ESSEX|The year|WINTER|HARVEST)/i.test(text)) {
                p.classList.add('section-start');
            }
            fragment.appendChild(p);
        }

        storyEl.appendChild(fragment); // Append all text at once to reduce lag
        syncState();
        if (window.updateScene) window.updateScene();
        updateHUD();
        renderChoices();

        if (!firstTime) scrollDown(prevBottom);
    }

    function renderChoices() {
        var hudChoices = document.getElementById('hud-choices');
        if (!hudChoices) return;
        hudChoices.innerHTML = '';
        
        if (!story.currentChoices.length) {
            hudChoices.innerHTML = '<span class="hud-no-choices">— reading —</span>';
        } else {
            story.currentChoices.forEach(function(choice) {
                var clickable = !choice.tags || !choice.tags.some(function(t) {
                    return t.toUpperCase() === 'UNCLICKABLE';
                });

                var item = document.createElement('div');
                item.className = 'hud-choice-item' + (clickable ? '' : ' disabled');
                
                // GLOW LOGIC:
                if (choice.text.toLowerCase().includes("wow, fascinating")) {
                    item.classList.add('attention-choice');
                }

                item.textContent = choice.text;

                if (clickable) {
                    item.addEventListener('click', function() {
                        hudChoices.innerHTML = '<span class="hud-no-choices">— reading —</span>';
                        lastChoiceText = choice.text;
                        story.ChooseChoiceIndex(choice.index);
                        savePoint = story.state.toJson();
                        continueStory();
                    });
                }
                hudChoices.appendChild(item);
            });
        }
    }

    function syncState() {
        var s = window.sceneState;
        if (!s) return;
        try {
            if (story.variablesState.$('death_check') === 'dead') s.isDead = true;
            var inkImage = story.variablesState.$('image');
            if (inkImage && inkImage.trim()) s.imageFile = inkImage.trim();
        } catch(e) {}
    }

    function checkDeath(text) {
        if (window.sceneState.isDead) return;
        var l = text.trim().toLowerCase();
        if (l === 'dead' || l.includes('you die') || l.includes('you are dead') || l.includes('starvation claims')) {
            window.sceneState.isDead = true;
        }
    }

    function isVocabLine(text) {
        return text.includes('VOCAB UNLOCKED') || text.includes('New Vocab Unlocked') ||
               text.includes('______________________') ||
               /^([—–-]\s*)?[^:]+:.+/.test(text.trim()) || 
               text.includes('Fun fact:');
    }

    function extractVocab(text) {
        text.split('\n').forEach(function(line) {
            var m = line.trim().match(/^([—–-]\s*)?(.+?):\s*(.+)/);
            if (m) addVocabEntry(m[2].trim(), m[3].trim());
            var f = line.match(/fun fact:\s*(.+)/i);
            if (f) addVocabEntry('Fun Fact', f[1].trim());
        });
    }

    function addVocabEntry(term, def) {
        var list = document.getElementById('vocab-list');
        if (!list) return;
        var placeholder = list.querySelector('.panel-placeholder');
        if (placeholder) placeholder.remove();
        var existing = list.querySelectorAll('.vocab-term');
        for (var i = 0; i < existing.length; i++) {
            if (existing[i].textContent === term) return;
        }
        var entry = document.createElement('div');
        entry.className = 'vocab-entry';
        entry.innerHTML = '<div class="vocab-term">' + term + '</div><div class="vocab-def">' + def + '</div>';
        list.appendChild(entry);
    }

    function showVocabNotice() {
        if (storyEl.querySelector('.vocab-notice')) return;
        var note = document.createElement('p');
        note.className = 'vocab-notice';
        note.innerHTML = '<strong>New vocabulary unlocked.</strong> See the Vocab tab.';
        storyEl.appendChild(note);
    }

    function addJournalEntry(text, season) {
        var journal = document.getElementById('journal-entries');
        if (!journal) return;
        var placeholder = journal.querySelector('.panel-placeholder');
        if (placeholder) placeholder.remove();
        var entry = document.createElement('div');
        entry.className = 'journal-entry';
        entry.textContent = text;
        journal.appendChild(entry);
    }

    function flushDelta() {
        if (_pendingDeltas.length) { showDelta(_pendingDeltas); _pendingDeltas = []; }
    }

    function updateHUD() {
        try {
            var money = Number(story.variablesState.$('money')) || 0;
            var grain = Number(story.variablesState.$('grain')) || 0;
            [['money', money, 'coin'], ['grain', grain, 'grain']].forEach(function(row) {
                var diff = row[1] - (_prev[row[0]] === null ? row[1] : _prev[row[0]]);
                if (_prev[row[0]] !== null && Math.round(diff) !== 0) {
                    _pendingDeltas.push({ val: Math.round(diff), label: row[2] });
                }
                _prev[row[0]] = row[1];
            });
            setText('money-value', money);
            setText('grain-value', grain);
            setText('status-value', (story.variablesState.$('status') || 'villein').toUpperCase());
        } catch(e) {}
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function showDelta(deltas) {
        var el = document.getElementById('stat-delta');
        if (!el) return;
        if (_deltaTimer) clearTimeout(_deltaTimer);
        el.innerHTML = deltas.map(function(d) {
            var cls = d.val > 0 ? 'pos' : 'neg';
            return '<span class="delta-item ' + cls + '">' + (d.val > 0 ? '+' : '') + d.val + ' ' + d.label + '</span>';
        }).join('');
        el.classList.add('visible');
        _deltaTimer = setTimeout(function() { el.classList.remove('visible'); }, 2400);
    }

    function setupButtons() {
        var rewind = document.getElementById('rewind');
        if (rewind) rewind.addEventListener('click', function() { restart(); });
    }

    function restart() {
        story.ResetState();
        storyEl.innerHTML = '';
        window.sceneState.isDead = false;
        continueStory(true);
    }

    function splitTag(tag) {
        var i = tag.indexOf(':');
        return (i === -1) ? null : { key: tag.slice(0, i).trim(), val: tag.slice(i + 1).trim() };
    }

    function bottomEdge() {
        var last = storyEl.lastElementChild;
        return last ? last.offsetTop + last.offsetHeight : 0;
    }

    function scrollDown(prevBottom) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
    }

})(storyContent);
