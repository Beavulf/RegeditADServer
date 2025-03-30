function chb(balance) {
  // let balance = 0
  return function (sum,...sss) {
    balance += sum
    console.log(`PRIVET ${sss}`);
    
    return balance;
  }
}

const change = chb(1000)
console.log(change(100,'asdasd','11111'));
console.log(change(300));
console.dir(change)