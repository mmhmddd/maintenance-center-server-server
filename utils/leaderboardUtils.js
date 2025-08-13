export const calculateRankScore = (volunteerHours, numberOfStudents) => {
  const volunteerWeight = 0.6;
  const studentWeight = 0.4;  
  return (volunteerHours || 0) * volunteerWeight + (numberOfStudents || 0) * studentWeight;
};