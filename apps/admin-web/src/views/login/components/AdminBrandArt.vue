<template>
  <aside
    class="admin-brand-art"
    data-testid="admin-brand-art"
    aria-label="店长小助手烘焙角色插画"
  >
    <span class="admin-brand-art__spark admin-brand-art__spark--one">✦</span>
    <span class="admin-brand-art__spark admin-brand-art__spark--two">✧</span>
    <span class="admin-brand-art__sticker admin-brand-art__sticker--bread">
      今日现烤
    </span>
    <span class="admin-brand-art__sticker admin-brand-art__sticker--note">
      好心情营业中
    </span>

    <div class="admin-brand-art__character" aria-hidden="true">
      <div class="admin-brand-art__hat">
        <span></span><span></span><span></span>
      </div>
      <div class="admin-brand-art__face">
        <span class="admin-brand-art__ear admin-brand-art__ear--left"></span>
        <span class="admin-brand-art__ear admin-brand-art__ear--right"></span>
        <span class="admin-brand-art__eye admin-brand-art__eye--left"></span>
        <span class="admin-brand-art__eye admin-brand-art__eye--right"></span>
        <span
          class="admin-brand-art__blush admin-brand-art__blush--left"
        ></span>
        <span
          class="admin-brand-art__blush admin-brand-art__blush--right"
        ></span>
        <span class="admin-brand-art__smile"></span>
      </div>
      <div class="admin-brand-art__body">
        <span class="admin-brand-art__apron">B</span>
      </div>
      <div class="admin-brand-art__tray">
        <span class="admin-brand-art__bun"></span>
        <span class="admin-brand-art__bun"></span>
        <span class="admin-brand-art__bun"></span>
      </div>
    </div>

    <div class="admin-brand-art__copy">
      <p>店长小助手</p>
      <h2>把每一份新鲜，<br />认真送到客人手中。</h2>
      <span>商品 · Banner · 订单履约</span>
    </div>
  </aside>
</template>

<style scoped>
.admin-brand-art {
  position: relative;
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: min(760px, calc(100vh - 64px));
  padding: 52px 44px;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 18% 18%,
      rgb(255 255 255 / 70%) 0 4%,
      transparent 5%
    ),
    radial-gradient(circle at 78% 24%, rgb(233 139 172 / 20%), transparent 24%),
    radial-gradient(circle at 24% 74%, rgb(120 170 149 / 18%), transparent 25%),
    linear-gradient(145deg, #eee9fb 0%, #f8eef5 52%, #f8f1dc 100%);
  border: 1px solid rgb(255 255 255 / 78%);
  border-radius: 34px;
  color: var(--admin-text);
}

.admin-brand-art::before,
.admin-brand-art::after {
  position: absolute;
  width: 150px;
  height: 34px;
  background: rgb(255 255 255 / 35%);
  content: '';
  transform: rotate(-38deg);
}

.admin-brand-art::before {
  top: 36px;
  left: -44px;
}

.admin-brand-art::after {
  right: -45px;
  bottom: 72px;
}

.admin-brand-art__spark {
  position: absolute;
  color: var(--admin-primary);
  font-size: 28px;
}

.admin-brand-art__spark--one {
  top: 17%;
  left: 20%;
}

.admin-brand-art__spark--two {
  top: 31%;
  right: 15%;
  color: var(--admin-pink);
  font-size: 22px;
}

.admin-brand-art__sticker {
  position: absolute;
  z-index: 3;
  padding: 8px 13px;
  border: 2px solid rgb(255 255 255 / 78%);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 20px rgb(73 57 105 / 10%);
}

.admin-brand-art__sticker--bread {
  top: 13%;
  right: 12%;
  background: #f9df9f;
  color: #76521c;
  transform: rotate(7deg);
}

.admin-brand-art__sticker--note {
  top: 46%;
  left: 8%;
  background: #daf0e6;
  color: #426f5b;
  transform: rotate(-7deg);
}

.admin-brand-art__character {
  position: relative;
  width: 280px;
  height: 350px;
  margin-top: -22px;
}

.admin-brand-art__hat {
  position: absolute;
  z-index: 2;
  top: 12px;
  left: 75px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  width: 130px;
  height: 88px;
  background: #fffdf8;
  border: 4px solid #665780;
  border-radius: 60px 60px 24px 24px;
}

.admin-brand-art__hat span {
  width: 43px;
  height: 58px;
  margin: 0 -3px 24px;
  background: #fffdf8;
  border: 4px solid #665780;
  border-bottom: 0;
  border-radius: 50% 50% 0 0;
}

.admin-brand-art__hat span:nth-child(2) {
  height: 69px;
}

.admin-brand-art__face {
  position: absolute;
  z-index: 3;
  top: 75px;
  left: 62px;
  width: 156px;
  height: 145px;
  background: #ffe8d8;
  border: 4px solid #665780;
  border-radius: 48% 48% 45% 45%;
}

.admin-brand-art__ear {
  position: absolute;
  top: 53px;
  width: 24px;
  height: 37px;
  background: #ffe8d8;
  border: 4px solid #665780;
  border-radius: 50%;
}

.admin-brand-art__ear--left {
  left: -17px;
}

.admin-brand-art__ear--right {
  right: -17px;
}

.admin-brand-art__eye,
.admin-brand-art__blush {
  position: absolute;
  border-radius: 50%;
}

.admin-brand-art__eye {
  top: 59px;
  width: 9px;
  height: 13px;
  background: #574c69;
}

.admin-brand-art__eye--left {
  left: 42px;
}

.admin-brand-art__eye--right {
  right: 42px;
}

.admin-brand-art__blush {
  top: 82px;
  width: 24px;
  height: 10px;
  background: rgb(233 139 172 / 42%);
}

.admin-brand-art__blush--left {
  left: 19px;
}

.admin-brand-art__blush--right {
  right: 19px;
}

.admin-brand-art__smile {
  position: absolute;
  top: 82px;
  left: 66px;
  width: 21px;
  height: 12px;
  border-bottom: 3px solid #665780;
  border-radius: 50%;
}

.admin-brand-art__body {
  position: absolute;
  top: 196px;
  left: 38px;
  width: 204px;
  height: 134px;
  background: #8d79c7;
  border: 4px solid #665780;
  border-radius: 80px 80px 34px 34px;
}

.admin-brand-art__apron {
  position: absolute;
  top: 28px;
  left: 55px;
  display: grid;
  width: 86px;
  height: 95px;
  place-items: center;
  background: #fffdf8;
  border-radius: 32px 32px 18px 18px;
  color: var(--admin-pink);
  font-size: 31px;
  font-weight: 900;
}

.admin-brand-art__tray {
  position: absolute;
  z-index: 5;
  right: -6px;
  bottom: 9px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  width: 158px;
  height: 42px;
  background: #765b43;
  border: 4px solid #574a63;
  border-radius: 5px 5px 22px 22px;
  transform: rotate(-3deg);
}

.admin-brand-art__bun {
  width: 39px;
  height: 29px;
  margin-bottom: 25px;
  background: #e9b86c;
  border: 4px solid #765b43;
  border-radius: 50% 50% 42% 42%;
}

.admin-brand-art__copy {
  position: relative;
  z-index: 3;
  text-align: center;
}

.admin-brand-art__copy p {
  margin: 0 0 8px;
  color: var(--admin-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.admin-brand-art__copy h2 {
  margin: 0;
  font-size: clamp(24px, 2.8vw, 34px);
  line-height: 1.4;
  letter-spacing: -0.02em;
}

.admin-brand-art__copy span {
  display: block;
  margin-top: 12px;
  color: var(--admin-muted);
  font-size: 13px;
}
</style>
