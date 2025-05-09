exports.bark = (name) => {
    return `狗狗 ${name} 正在汪汪叫：汪! 汪!`;
};

exports.run = (name, speed) => {
    return `狗狗 ${name} 正以 ${speed} 公里/小时的速度奔跑`;
};

exports.eat = (name, food) => {
    return `狗狗 ${name} 正在吃 ${food}`;
};