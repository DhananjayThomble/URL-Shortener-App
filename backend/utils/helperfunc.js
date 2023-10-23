export const isValidEmail = (email)=>{
    validEmailRegex = /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/gi;
    return validEmailRegex.test(email);
}