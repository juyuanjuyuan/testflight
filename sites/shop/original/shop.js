// Shared by every page: cart state (sessionStorage) and the cart dialog.
const SEED = [{ id: 'beanie', name: 'Wool Beanie', price: 18, qty: 1 }]; // "saved from your last visit"
const PRODUCTS = {
  tote: { id: 'tote', name: 'Canvas Tote Bag', price: 24 },
  beanie: { id: 'beanie', name: 'Wool Beanie', price: 18 },
  mug: { id: 'mug', name: 'Stoneware Mug', price: 14 },
};
const money = (n) => `$${n.toFixed(2)}`;
function loadCart() { return JSON.parse(sessionStorage.getItem('cart') || JSON.stringify(SEED)); }
function saveCart(c) { sessionStorage.setItem('cart', JSON.stringify(c)); }
function subtotal(c) { return c.reduce((s, x) => s + x.price * x.qty, 0); }

// Rotating promo banner: noise, not a barrier. Only on the landing page, where the recorder's idle baseline sees it
// rotate before the first action (after a navigation there is no baseline yet; see docs/plans/05-fake-shop.md).
function rotatePromo() {
  const promos = ['Free shipping over $50', 'New arrivals every Friday', 'Gift cards now available'];
  let k = 0;
  setInterval(() => { document.getElementById('promo').textContent = promos[++k % promos.length]; }, 700);
}

function addToCart(id) {
  const c = loadCart();
  const item = c.find((x) => x.id === id);
  if (item) item.qty++; else c.push({ ...PRODUCTS[id], qty: 1 });
  saveCart(c);
}

function cartRow(item) {
  const li = document.createElement('li');
  li.dataset.id = item.id;
  li.innerHTML = `<span class="name">${item.name} <span class="price">${money(item.price)}</span></span>
    <button type="button" class="btn light remove" data-barrier="B6">Remove</button>
    <button type="button" class="qtybtn dec" data-barrier="B5">−</button>
    <span class="qty" data-barrier="B4">Qty ${item.qty}</span>
    <button type="button" class="qtybtn inc" data-barrier="B5">+</button>`;
  return li;
}

function openCart() {
  const dlg = document.getElementById('cart');
  const list = dlg.querySelector('ul');
  list.replaceChildren(...loadCart().map(cartRow));
  document.getElementById('subtotal').textContent = `Subtotal ${money(subtotal(loadCart()))}`;
  dlg.hidden = false;
  dlg.focus();
}
function closeCart() {
  document.getElementById('cart').hidden = true;
  document.getElementById('cartbtn').focus();
}
function changeQty(li, delta) {
  const c = loadCart();
  const item = c.find((x) => x.id === li.dataset.id);
  item.qty = Math.max(1, item.qty + delta);
  saveCart(c);
  li.querySelector('.qty').textContent = `Qty ${item.qty}`;
  document.getElementById('subtotal').textContent = `Subtotal ${money(subtotal(c))}`;
}
function removeItem(li) {
  const c = loadCart().filter((x) => x.id !== li.dataset.id);
  saveCart(c);
  li.remove();
  document.getElementById('subtotal').textContent = `Subtotal ${money(subtotal(c))}`;
}

function initCart() {
  const dlg = document.getElementById('cart');
  document.getElementById('cartbtn').addEventListener('click', openCart);
  dlg.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (e.target.classList.contains('remove')) removeItem(li);
    else if (e.target.classList.contains('dec')) changeQty(li, -1);
    else if (e.target.classList.contains('inc')) changeQty(li, 1);
  });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });
  document.getElementById('keepshopping').addEventListener('click', closeCart);
  document.getElementById('gocheckout').addEventListener('click', () => { location.href = 'checkout.html'; });
}
