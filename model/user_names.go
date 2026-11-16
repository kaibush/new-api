package model

// UserName is the minimal identity exposed by the administrator lookup.
type UserName struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

func GetUserNames(ids []int) ([]UserName, error) {
	users := make([]UserName, 0, len(ids))
	if len(ids) == 0 {
		return users, nil
	}
	err := DB.Model(&User{}).Select("id", "username").Where("id IN ?", ids).Find(&users).Error
	return users, err
}
