// Your original JavaScript, moved here from: index.html (inline <script>)
//
// It still changes the page directly (document.querySelector, classList,
// innerHTML, ...). That works, but React doesn't know about those changes.
// As you learn React, move this code into your components piece by piece.
// When this file is empty, delete it along with its import in HomePage.jsx.

import { trackPage } from '../legacy-page.js'

export function runLegacyScript() {
  // Converter: when you open another page, React removes this one, but
  // listeners on window/document and timers would keep running. These
  // versions remember them so they stop when you leave the page.
  const legacyPage = trackPage()
  const { setTimeout, setInterval, requestAnimationFrame } = legacyPage

  (() => {
      const {baseRows, baseCols} = {baseRows: 2, baseCols: 2};
      
      const pieceDock = document.querySelector('.rectangle').getBoundingClientRect();

      const puzzleBase = document.querySelector('.square');
      const { width: baseW, height: baseH, left: baseX, top: baseY } = puzzleBase.getBoundingClientRect();
      puzzleBase.style.setProperty('--rows', baseRows);
      puzzleBase.style.setProperty('--cols', baseCols);


      const completed_picture = document.getElementById('completed-picture');
      completed_picture.style.height = `${baseH}px`;
      completed_picture.style.width = `${baseW}px`;
      completed_picture.style.left = `${baseX}px`;
      completed_picture.style.top = `${baseY}px`;

      const puzzlePieces = document.querySelector('.draggable');
      const originalPieceW = puzzlePieces.getBoundingClientRect().width;
      console.log(originalPieceW)

      function getPosition(piece) {
          const left = parseFloat(getComputedStyle(piece).left);
          const top  = parseFloat(getComputedStyle(piece).top);
          return { x: left, y: top };
      }

      function setPosition(piece, x, y, clampToViewport = true) {
          piece.style.left = `${x}px`;
          piece.style.top  = `${y}px`;
      }

      function getRandomPositionInDock(dockRect, pieceW){
          const minX = dockRect.left;
          const minY = dockRect.top;
          const maxX = dockRect.right  - pieceW;
          const maxY = dockRect.bottom - pieceW;
          const x = Math.random() * (maxX - minX) + minX;
          const y = Math.random() * (maxY - minY) + minY;
          return { x, y };
      }

      const STATE = new WeakMap();

      function onPointerDown(e, baseW) {
          const el = e.currentTarget;
          el.classList.add('dragging');
          el.setPointerCapture?.(e.pointerId);
          el.style.width  = `${baseW / 2}px`;
          el.style.height = 'auto';
          const { x, y } = getPosition(el);
          STATE.set(el, {
              startX: e.clientX,
              startY: e.clientY,
              baseX: x,
              baseY: y
          });
      }

      function onPointerMove(e) {
          const el = e.currentTarget;
          const st = STATE.get(el);
          if (!st) return;
          const dx = e.clientX - st.startX;
          const dy = e.clientY - st.startY;
          setPosition(el, st.baseX + dx, st.baseY + dy, /* clamp */ true);
      }

      function onPointerUp(e) {
          const el = e.currentTarget;
          el.classList.remove('dragging');
          const row = Number(el.dataset.row);
          const col = Number(el.dataset.col);
          const pieceW = baseW / baseCols;
          const pieceH = baseH / baseRows;
          const {x: pieceX, y: pieceY} = getPosition(el);
          const inPosition = (Math.abs(baseX + pieceW*col - pieceX) < pieceW/3) && (Math.abs(baseY + pieceH*row - pieceY) < pieceH/3)
          console.log(baseX, pieceW, col, pieceX, baseY, pieceH, row, pieceY);
          if (inPosition) {
              setPosition(el, baseX + pieceW*col, baseY + pieceH*row);
              el.classList.add('in-position');
              detectSolved();
          } else {
              el.style.width = `${originalPieceW}px`;
              el.style.height = `${originalPieceW}px`;
              const {x: dockX, y: dockY} = getRandomPositionInDock(pieceDock, originalPieceW)
              setPosition(el, dockX, dockY);
              el.classList.remove('in-position');
          }
          STATE.delete(el);
      }

      function detectSolved() {
          const numOfInPosition = document.getElementsByClassName('in-position').length;
          const statusEl = document.getElementById('status');
          if (numOfInPosition == baseRows*baseCols) {
              completed_picture.classList.add("is-visible")
              statusEl.textContent = '🧩🎊 Yay!! You solved!! 🎉✨';
              document.querySelectorAll('.draggable').forEach(piece => {
                  piece.style.pointerEvents = 'none';
                  piece.style.cursor = 'default';
              });
          }
      }

      document.querySelectorAll('.draggable').forEach(el => {
          const { width: pieceW, height: pieceH } = el.getBoundingClientRect();
          const { x: pieceX, y: pieceY } = getRandomPositionInDock(pieceDock, originalPieceW);
          setPosition(el, pieceX, pieceY);
          
          el.addEventListener('dragstart', ev => ev.preventDefault());
          el.addEventListener('pointerdown', (e) => onPointerDown(e, baseW));
          el.addEventListener('pointermove', onPointerMove);
          el.addEventListener('pointerup',   onPointerUp);
          el.addEventListener('pointercancel', onPointerUp);
      });

  })();

  return legacyPage.stop
}

// Code that changes the page directly can't be swapped in while the page is
// running, so the whole page reloads whenever a JavaScript file changes.
// (CSS changes still update instantly.) Remove this along with the file.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((update) => update.type === 'js-update')) location.reload()
  })
}
