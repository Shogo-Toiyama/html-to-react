// Your original JavaScript, moved here from: index2.html (inline <script>)
//
// It still changes the page directly (document.querySelector, classList,
// innerHTML, ...). That works, but React doesn't know about those changes.
// As you learn React, move this code into your components piece by piece.
// When this file is empty, delete it along with its import in Index2Page.jsx.

import { trackPage } from '../legacy-page.js'

export function runLegacyScript() {
  // Converter: when you open another page, React removes this one, but
  // listeners on window/document and timers would keep running. These
  // versions remember them so they stop when you leave the page.
  const legacyPage = trackPage()
  const { setTimeout, setInterval, requestAnimationFrame } = legacyPage

  (() => {
      const originalPieceW = 100;
      const baseRows = 2, baseCols = 2;

      const game   = document.querySelector('.game');
      const base  = document.getElementById('base');
      const dock   = document.getElementById('dock');
      const done   = document.getElementById('completed-picture');
      const status = document.getElementById('status');

      base.style.setProperty('--rows', baseRows);
      base.style.setProperty('--cols', baseCols);

      let gameRect, boardRect, dockRect;
      function measure() {
          gameRect  = game.getBoundingClientRect();
          boardRect = board.getBoundingClientRect();
          dockRect  = dock.getBoundingClientRect();
      }
      measure();

      const posPct = new Map();

      function pxToPct(x, y) {
          return {
          xPct: (x / gameRect.width) * 100,
          yPct: (y / gameRect.height) * 100
          };
      }
      function pctToPx(xPct, yPct) {
          return {
          x: (xPct / 100) * gameRect.width,
          y: (yPct / 100) * gameRect.height
          };
      }

      function setPositionPx(el, x, y) {
          el.style.left = `${x}px`;
          el.style.top  = `${y}px`;
          posPct.set(el, pxToPct(x, y));
      }
      function restorePositionFromPct(el) {
          const p = posPct.get(el); if (!p) return;
          const {x, y} = pctToPx(p.xPct, p.yPct);
          el.style.left = `${x}px`;
          el.style.top  = `${y}px`;
      }

      function localXY(clientX, clientY) {
          // client座標を game のローカル座標に変換
          return { x: clientX - gameRect.left, y: clientY - gameRect.top };
      }

      const puzzlePieces = document.querySelector('.draggable');

      function randomInDock(pieceW) {
          // dockのローカル座標に変換
          const dl = dockRect.left - gameRect.left;
          const dt = dockRect.top  - gameRect.top;
          const dr = dl + dockRect.width;
          const db = dt + dockRect.height;
          const minX = dl, minY = dt;
          const maxX = dr - pieceW, maxY = db - pieceW;
          const x = Math.random() * (maxX - minX) + minX;
          const y = Math.random() * (maxY - minY) + minY;
          return {x, y};
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
